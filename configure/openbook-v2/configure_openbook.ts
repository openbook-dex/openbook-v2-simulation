import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TestProvider } from "../anchor_utils";
import { Market, createMarket } from "./create_markets";
import { MintUtils } from "../general/mint_utils";
import { OpenbookV2 } from "./openbook_v2";
import IDL from "../programs/openbook_v2.json";
import { BN, Program, web3 } from "@project-serum/anchor";
import { User } from "../general/create_users";
import { U64_MAX_BN } from "@blockworks-foundation/mango-v4";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface OpenOrders {
  market: PublicKey;
  open_orders: PublicKey;
}

export class OpenbookConfigurator {
  anchorProvider: TestProvider;
  mintUtils: MintUtils;
  openbookProgramId: PublicKey;
  program: Program<OpenbookV2>;

  constructor(
    connection: Connection,
    authority: Keypair,
    mintUtils: MintUtils,
    openbookProgramId: PublicKey,
  ) {
    this.anchorProvider = new TestProvider(connection, authority);
    this.mintUtils = mintUtils;
    this.openbookProgramId = openbookProgramId;
    this.program = new Program<OpenbookV2>(
      IDL as OpenbookV2,
      this.openbookProgramId,
      this.anchorProvider,
    );
  }

  public async configureOpenbookV2(mints: PublicKey[]): Promise<Market[]> {
    let quoteMint = mints[0];
    let admin = Keypair.generate();
    return await Promise.all(
      mints
        .slice(1)
        .map((mint, index) =>
          createMarket(
            this.program,
            this.anchorProvider,
            this.mintUtils,
            admin,
            this.openbookProgramId,
            mint,
            quoteMint,
            index,
          ),
        ),
    );
  }

  public async configureMarketForUser(
    user: Keypair,
    markets: Market[],
  ): Promise<OpenOrders[]> {
    let [openOrdersIndexer, _tmp1] = PublicKey.findProgramAddressSync(
      [Buffer.from("OpenOrdersIndexer"), user.publicKey.toBuffer()],
      this.openbookProgramId,
    );
    await this.program.methods
      .createOpenOrdersIndexer()
      .accounts({
        openOrdersIndexer,
        owner: user.publicKey,
        payer: this.anchorProvider.keypair.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const openOrdersAccs = [];
    for (let i = 0; i < markets.length; ++i) {
      const market = markets[i];
      const accountIndex = new BN(i + 1);

      let [openOrders, _tmp] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("OpenOrders"),
          user.publicKey.toBuffer(),
          accountIndex.toBuffer("le", 4),
        ],
        this.openbookProgramId,
      );

      await this.program.methods
        .createOpenOrdersAccount("test simulator")
        .accounts({
          openOrdersIndexer,
          openOrdersAccount: openOrders,
          market: market.market_pk,
          owner: user.publicKey,
          delegateAccount: null,
          payer: this.anchorProvider.keypair.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      openOrdersAccs.push({
        market: market.market_pk,
        open_orders: openOrders,
      });
    }

    return openOrdersAccs;
  }

  public async fillOrderBook(
    user: User,
    userKp: Keypair,
    marketData: Market,
    nbOrders: number,
  ) {
    for (let i = 0; i < nbOrders; ++i) {
      let side = { bid: {} };
      let placeOrder = { limit: {} };
      let selfTradeBehavior = { decrementTake: {} };

      let args = {
        side,
        priceLots: new BN(1000 - 1 - i),
        maxBaseLots: new BN(10),
        maxQuoteLotsIncludingFees: new BN(1000000),
        clientOrderId: new BN(i),
        orderType: placeOrder,
        expiryTimestamp: U64_MAX_BN,
        selfTradeBehavior: selfTradeBehavior,
        limit: 255,
      };

      await this.program.methods
        .placeOrder(args)
        .accounts({
          asks: marketData.asks,
          marketVault: marketData.quote_vault,
          bids: marketData.bids,
          eventHeap: marketData.event_heap,
          market: marketData.market_pk,
          openOrdersAccount:
            user.open_orders[marketData.market_index].open_orders,
          oracleA: marketData.oracle_a,
          oracleB: marketData.oracle_b,
          signer: userKp.publicKey,
          userTokenAccount: user.token_data[0].token_account,
          tokenProgram: TOKEN_PROGRAM_ID,
          openOrdersAdmin: null,
        })
        .signers([userKp])
        .rpc();
    }

    for (let i = 0; i < nbOrders; ++i) {
      let side = { ask: {} };
      let placeOrder = { limit: {} };
      let selfTradeBehavior = { decrementTake: {} };

      let args = {
        side,
        priceLots: new BN(1000 + 1 + i),
        maxBaseLots: new BN(10000),
        maxQuoteLotsIncludingFees: new BN(1000000),
        clientOrderId: new BN(i + nbOrders + 1),
        orderType: placeOrder,
        expiryTimestamp: U64_MAX_BN,
        selfTradeBehavior: selfTradeBehavior,
        limit: 255,
      };
      await this.program.methods
        .placeOrder(args)
        .accounts({
          asks: marketData.asks,
          marketVault: marketData.base_vault,
          bids: marketData.bids,
          eventHeap: marketData.event_heap,
          market: marketData.market_pk,
          openOrdersAccount:
            user.open_orders[marketData.market_index].open_orders,
          oracleA: marketData.oracle_a,
          oracleB: marketData.oracle_b,
          signer: userKp.publicKey,
          userTokenAccount: user.token_data
            .filter((x) => x.mint === marketData.base_mint)
            .at(0)?.token_account,
          tokenProgram: TOKEN_PROGRAM_ID,
          openOrdersAdmin: null,
        })
        .signers([userKp])
        .rpc();
    }
  }
}
