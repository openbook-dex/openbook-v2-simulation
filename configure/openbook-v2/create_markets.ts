import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BorshAccountsCoder, Program, web3, BN } from "@project-serum/anchor";
import { createAccount } from "../general/solana_utils";
import { MintUtils } from "../general/mint_utils";
import { IDL, OpenbookV2 } from "./openbook_v2";
import { TestProvider } from "../anchor_utils";

export interface Market {
  name: string;
  admin: number[];
  market_pk: PublicKey;
  oracle_a: PublicKey;
  oracle_b: PublicKey;
  asks: PublicKey;
  bids: PublicKey;
  event_heap: PublicKey;
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

function getAccountSize(name: string) {
  const coder = new BorshAccountsCoder(IDL);
  const idlAccount = IDL.accounts?.filter(
    (idlAccount) => idlAccount.name === name,
  )[0];
  return coder.size(idlAccount);
}

export async function createMarket(
  program: Program<OpenbookV2>,
  anchorProvider: TestProvider,
  mintUtils: MintUtils,
  adminKp: Keypair,
  openbookProgramId: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  index: number,
): Promise<Market> {
  adminKp = anchorProvider.keypair;

  let [oracleAId, _tmp1] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("StubOracle"),
      adminKp.publicKey.toBytes(),
      baseMint.toBytes(),
    ],
    openbookProgramId,
  );

  let [oracleBId, _tmp3] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("StubOracle"),
      adminKp.publicKey.toBytes(),
      quoteMint.toBytes(),
    ],
    openbookProgramId,
  );

  let price = parseFloat(getRandomInt(1000).toFixed(2));

  if ((await anchorProvider.connection.getAccountInfo(oracleAId)) == null) {
    await program.methods
      .stubOracleCreate(1.0)
      .accounts({
        payer: adminKp.publicKey,
        oracle: oracleAId,
        mint: baseMint,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([adminKp])
      .rpc();
  }
  if ((await anchorProvider.connection.getAccountInfo(oracleBId)) == null) {
    await program.methods
      .stubOracleCreate(1.0)
      .accounts({
        payer: adminKp.publicKey,
        oracle: oracleBId,
        mint: quoteMint,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([adminKp])
      .rpc();
  }

  await program.methods
    .stubOracleSet(price)
    .accounts({
      owner: adminKp.publicKey,
      oracle: oracleAId,
    })
    .signers([adminKp])
    .rpc();

  await program.methods
    .stubOracleSet(price)
    .accounts({
      owner: adminKp.publicKey,
      oracle: oracleBId,
    })
    .signers([adminKp])
    .rpc();

  let asks = await createAccount(
    anchorProvider.connection,
    anchorProvider.keypair,
    getAccountSize("bookSide"),
    openbookProgramId,
  );
  let bids = await createAccount(
    anchorProvider.connection,
    anchorProvider.keypair,
    getAccountSize("bookSide"),
    openbookProgramId,
  );
  let eventHeap = await createAccount(
    anchorProvider.connection,
    anchorProvider.keypair,
    getAccountSize("eventHeap"),
    openbookProgramId,
  );

  let marketPk = Keypair.generate();

  let [marketAuthority, _tmp2] = PublicKey.findProgramAddressSync(
    [Buffer.from("Market"), marketPk.publicKey.toBuffer()],
    openbookProgramId,
  );

  let baseVault = getAssociatedTokenAddressSync(
    baseMint,
    marketAuthority,
    true,
  );
  let quoteVault = getAssociatedTokenAddressSync(
    quoteMint,
    marketAuthority,
    true,
  );
  let name = "index " + index.toString() + " wrt 0";

  let [eventAuthority, tmp3] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    openbookProgramId,
  );

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
      new BN(0),
    )
    .accounts({
      market: marketPk.publicKey,
      marketAuthority,
      bids,
      asks,
      eventHeap,
      payer: adminKp.publicKey,
      marketBaseVault: baseVault,
      marketQuoteVault: quoteVault,
      baseMint,
      quoteMint,
      systemProgram: web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      oracleA: oracleAId,
      oracleB: oracleBId,
      collectFeeAdmin: adminKp.publicKey,
      openOrdersAdmin: null,
      closeMarketAdmin: null,
      consumeEventsAdmin: null,
      eventAuthority,
      program: openbookProgramId,
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
    event_heap: eventHeap,
    base_mint: baseMint,
    base_vault: baseVault,
    market_index: index,
    market_pk: marketPk.publicKey,
    oracle_a: oracleAId,
    oracle_b: oracleBId,
    quote_mint: quoteMint,
    quote_vault: quoteVault,
    price,
  };
}
