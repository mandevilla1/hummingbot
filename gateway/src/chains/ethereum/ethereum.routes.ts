/* eslint-disable @typescript-eslint/ban-types */
import { Wallet } from 'ethers';
import { NextFunction, Router, Request, Response } from 'express';
import { Ethereum } from './ethereum';
import { EthereumConfig } from './ethereum.config';
import { ConfigManager } from '../../services/config-manager';
import { Token } from '../../services/ethereum-base';
import { verifyEthereumIsAvailable } from './ethereum-middlewares';
import { HttpException, asyncHandler } from '../../services/error-handler';
import { latency } from '../../services/base';
import { tokenValueToString } from '../../services/base';
import { UniswapConfig } from './uniswap/uniswap.config';
import {
  EthereumTransactionReceipt,
  approve,
  poll,
} from './ethereum.controllers';

export namespace EthereumRoutes {
  export const router = Router();
  const ethereum = Ethereum.getInstance();
  export const reload = (): void => {
    // ethereum = Ethereum.reload();
  };

  router.use(asyncHandler(verifyEthereumIsAvailable));

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      let rpcUrl;
      if (ConfigManager.config.ETHEREUM_CHAIN === 'mainnet') {
        rpcUrl = EthereumConfig.config.mainnet.rpcUrl;
      } else {
        rpcUrl = EthereumConfig.config.kovan.rpcUrl;
      }

      res.status(200).json({
        network: ConfigManager.config.ETHEREUM_CHAIN,
        rpcUrl: rpcUrl,
        connection: true,
        timestamp: Date.now(),
      });
    })
  );

  interface EthereumAllowancesRequest {
    privateKey: string; // the users private Ethereum key
    spender: string; // the spender address for whom approvals are checked
    tokenSymbols: string[]; // a list of token symbol
  }

  interface EthereumAllowancesResponse {
    network: string;
    timestamp: number;
    latency: number;
    spender: string;
    approvals: Record<string, string>;
  }

  const getSpender = (reqSpender: string): string => {
    let spender: string;
    if (reqSpender === 'uniswap') {
      if (ConfigManager.config.ETHEREUM_CHAIN === 'mainnet') {
        spender = UniswapConfig.config.mainnet.uniswapV2RouterAddress;
      } else {
        spender = UniswapConfig.config.kovan.uniswapV2RouterAddress;
      }
    } else {
      spender = reqSpender;
    }

    return spender;
  };

  const getTokenSymbolsToTokens = (
    tokenSymbols: Array<string>
  ): Record<string, Token> => {
    const tokens: Record<string, Token> = {};

    for (var i = 0; i < tokenSymbols.length; i++) {
      const symbol = tokenSymbols[i];
      const token = ethereum.getTokenBySymbol(symbol);
      if (!token) {
        continue;
      }

      tokens[symbol] = token;
    }

    return tokens;
  };

  router.post(
    '/allowances',
    asyncHandler(
      async (
        req: Request<{}, {}, EthereumAllowancesRequest>,
        res: Response<EthereumAllowancesResponse | string, {}>
      ) => {
        const initTime = Date.now();
        const wallet = ethereum.getWallet(req.body.privateKey);

        const tokens = getTokenSymbolsToTokens(req.body.tokenSymbols);

        const spender = getSpender(req.body.spender);

        let approvals: Record<string, string> = {};
        await Promise.all(
          Object.keys(tokens).map(async (symbol) => {
            approvals[symbol] = tokenValueToString(
              await ethereum.getERC20Allowance(
                wallet,
                spender,
                tokens[symbol].address,
                tokens[symbol].decimals
              )
            );
          })
        );

        res.status(200).json({
          network: ConfigManager.config.ETHEREUM_CHAIN,
          timestamp: initTime,
          latency: latency(initTime, Date.now()),
          spender: spender,
          approvals: approvals,
        });
      }
    )
  );

  interface EthereumBalanceRequest {
    privateKey: string; // the users private Ethereum key
    tokenSymbols: string[]; // a list of token symbol
  }

  interface EthereumBalanceResponse {
    network: string;
    timestamp: number;
    latency: number;
    balances: Record<string, string>; // the balance should be a string encoded number
  }

  router.post(
    '/balances',
    asyncHandler(
      async (
        req: Request<{}, {}, EthereumBalanceRequest>,
        res: Response<EthereumBalanceResponse | string, {}>,
        _next: NextFunction
      ) => {
        const initTime = Date.now();

        let wallet: Wallet;
        try {
          wallet = ethereum.getWallet(req.body.privateKey);
        } catch (err) {
          throw new HttpException(500, 'Error getting wallet ' + err);
        }

        const tokens = getTokenSymbolsToTokens(req.body.tokenSymbols);

        const balances: Record<string, string> = {};
        balances.ETH = tokenValueToString(await ethereum.getEthBalance(wallet));
        await Promise.all(
          Object.keys(tokens).map(async (symbol) => {
            if (tokens[symbol] !== undefined) {
              const address = tokens[symbol].address;
              const decimals = tokens[symbol].decimals;
              const balance = await ethereum.getERC20Balance(
                wallet,
                address,
                decimals
              );
              balances[symbol] = tokenValueToString(balance);
            }
          })
        );

        res.status(200).json({
          network: ConfigManager.config.ETHEREUM_CHAIN,
          timestamp: initTime,
          latency: latency(initTime, Date.now()),
          balances: balances,
        });
      }
    )
  );

  interface EthereumApproveRequest {
    amount?: string;
    privateKey: string;
    spender: string;
    token: string;
  }

  interface EthereumApproveResponse {
    network: string;
    timestamp: number;
    latency: number;
    tokenAddress: string;
    spender: string;
    amount: string;
    approval: boolean | string;
  }

  router.post(
    '/approve',
    asyncHandler(
      async (
        req: Request<{}, {}, EthereumApproveRequest>,
        res: Response<EthereumApproveResponse | string, {}>
      ) => {
        const { spender, privateKey, token, amount } = req.body;
        const result = await approve(spender, privateKey, token, amount);
        return res.status(200).json(result);
      }
    )
  );

  interface EthereumPollRequest {
    txHash: string;
  }

  interface EthereumPollResponse {
    network: string;
    timestamp: number;
    latency: number;
    txHash: string;
    confirmed: boolean;
    receipt: EthereumTransactionReceipt | null;
  }

  router.post(
    '/poll',
    asyncHandler(
      async (
        req: Request<{}, {}, EthereumPollRequest>,
        res: Response<EthereumPollResponse, {}>
      ) => {
        const result = await poll(req.body.txHash);
        res.status(200).json(result);
      }
    )
  );
}