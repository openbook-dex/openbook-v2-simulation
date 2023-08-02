import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Program, web3, BN } from "@project-serum/anchor";
import { createAccount } from "../general/solana_utils";
import { MintUtils } from "../general/mint_utils";
import { OpenbookV2 } from "./openbook_v2";
import { TestProvider } from "../anchor_utils";

export interface Market {
  name: string;
  admin: number[];
  market_pk: PublicKey;
  oracleA: PublicKey;
  oracleB: PublicKey;
  asks: PublicKey;
  bids: PublicKey;
  event_queue: PublicKey;
  base_vault: PublicKey;
  quote_vault: PublicKey;
  base_mint: PublicKey;
  quote_mint: PublicKey;
  market_index: number;
  price: number;
}

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max) + 100;
}

export async function createMarket(
  program: Program<OpenbookV2>,
  anchorProvider: TestProvider,
  mintUtils: MintUtils,
  adminKp: Keypair,
  openbookProgramId: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  index: number
): Promise<Market> {
  let [oracleAId, _tmp1] = PublicKey.findProgramAddressSync(
    [Buffer.from("StubOracle"), baseMint.toBytes()],
    openbookProgramId
  );

  let [oracleBId, _tmp3] = PublicKey.findProgramAddressSync(
    [Buffer.from("StubOracle"), quoteMint.toBytes()],
    openbookProgramId
  );

  let price = getRandomInt(1000);

  let sig = await anchorProvider.connection.requestAirdrop(
    adminKp.publicKey,
    1000 * LAMPORTS_PER_SOL
  );
  await anchorProvider.connection.confirmTransaction(sig);

  await program.methods
    .stubOracleCreate({ val: new BN(1) })
    .accounts({
      payer: adminKp.publicKey,
      oracle: oracleAId,
      mint: baseMint,
      systemProgram: web3.SystemProgram.programId,
    })
    .signers([adminKp])
    .rpc();

  await program.methods
    .stubOracleCreate({ val: new BN(1) })
    .accounts({
      payer: adminKp.publicKey,
      oracle: oracleBId,
      mint: baseMint,
      systemProgram: web3.SystemProgram.programId,
    })
    .signers([adminKp])
    .rpc();

  await program.methods
    .stubOracleSet({
      val: new BN(price),
    })
    .accounts({
      oracle: oracleAId,
    })
    .signers([adminKp])
    .rpc();

  await program.methods
    .stubOracleSet({
      val: new BN(price),
    })
    .accounts({
      oracle: oracleBId,
    })
    .signers([adminKp])
    .rpc();

  // bookside size = 123720
  let asks = await createAccount(
    anchorProvider.connection,
    anchorProvider.keypair,
    123720,
    openbookProgramId
  );
  let bids = await createAccount(
    anchorProvider.connection,
    anchorProvider.keypair,
    123720,
    openbookProgramId
  );
  let eventQueue = await createAccount(
    anchorProvider.connection,
    anchorProvider.keypair,
    101592,
    openbookProgramId
  );

  let marketPk = Keypair.generate();

  let [marketAuthority, _tmp2] = PublicKey.findProgramAddressSync(
    [Buffer.from("Market"), marketPk.publicKey.toBuffer()],
    openbookProgramId
  );

  let baseVault = await mintUtils.createTokenAccount(
    baseMint,
    anchorProvider.keypair,
    marketPk.publicKey
  );
  let quoteVault = await mintUtils.createTokenAccount(
    quoteMint,
    anchorProvider.keypair,
    marketPk.publicKey
  );
  let name = "index " + index.toString() + " wrt 0";

  await program.methods
    .createMarket(
      name,
      {
        confFilter: 0,
        maxStalenessSlots: 100,
      },
      new BN(1),
      new BN(1),
      new BN(0),
      new BN(0),
      new BN(0)
    )
    .accounts({
      market: marketPk.publicKey,
      marketAuthority,
      bids,
      asks,
      eventQueue,
      payer: adminKp.publicKey,
      baseVault,
      quoteVault,
      baseMint,
      quoteMint,
      systemProgram: web3.SystemProgram.programId,
      oracleA: oracleAId,
      oracleB: oracleBId,
      collectFeeAdmin: adminKp.publicKey,
      openOrdersAdmin: null,
      closeMarketAdmin: null,
      consumeEventsAdmin: null,
    })
    .preInstructions([
      web3.ComputeBudgetProgram.setComputeUnitLimit({
        units: 10_000_000,
      }),
    ])
    .signers([adminKp, marketPk])
    .rpc();

  return {
    admin: Array.from(adminKp.secretKey),
    name,
    bids,
    asks,
    event_queue: eventQueue,
    base_mint: baseMint,
    base_vault: baseVault,
    market_index: index,
    market_pk: marketPk.publicKey,
    oracleA: oracleAId,
    oracleB: oracleBId,
    quote_mint: quoteMint,
    quote_vault: quoteVault,
    price,
  };
}
