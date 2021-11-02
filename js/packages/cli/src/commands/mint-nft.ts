import {
  createAssociatedTokenAccountInstruction,
  createMetadataInstruction,
  createMasterEditionInstruction,
  createUpdateMetadataInstruction,
} from '../helpers/instructions';
import { sendTransactionWithRetryWithKeypair } from '../helpers/transactions';
import {
  getTokenWallet,
  getMetadata,
  getMasterEdition,
} from '../helpers/accounts';
import * as anchor from '@project-serum/anchor';
import {
  Data,
  Creator,
  CreateMetadataArgs,
  UpdateMetadataArgs,
  CreateMasterEditionArgs,
  METADATA_SCHEMA,
} from '../helpers/schema';
import { serialize } from 'borsh';
import { TOKEN_PROGRAM_ID } from '../helpers/constants';
import { MintLayout, Token } from '@solana/spl-token';
import {
  Keypair,
  Connection,
  SystemProgram,
  TransactionInstruction,
  PublicKey,
} from '@solana/web3.js';
import log from 'loglevel';

export const createMetadata = async (): Promise<Data> => {
  // Metadata
  // TODO (@rafa): This should be parameterized, so we provide the metadata that the application
  // send us.

  // TODO (@rafa): Creator should be updated to be the address from the connected wallet.
  // This should be another paramater that gets passed to mintNFT
  const creator = new Creator({
    address: 'HgrU4Q4Lvoo82tBek4EuVWsGdHWtojZGYKBEH7AwurgP',
    share: 100,
    verified: 1,
  });

  return new Data({
    symbol: '',
    name: 'YET ANOTHER TESt',
    uri: 'https://arweave.net/9KnHpGOIakbJdzoKy7904GYdUilOH4WH8ELXoFO9VQs',
    sellerFeeBasisPoints: 0,
    creators: [creator],
  });
};

// TODO (@rafa): Update to be a connection and wallet that is provided from the context of the browser.
// Right now I was testing this from the console so is slightly different.
// TODO (@rafa): make metadata a parameter to this function.
export const mintNFT = async (
  connection: Connection,
  walletKeypair: Keypair,
  mutableMetadata: boolean = true,
): Promise<PublicKey | void> => {
  // Retrieve metadata
  const data = await createMetadata();
  if (!data) return;

  // Create wallet from keypair
  const wallet = new anchor.Wallet(walletKeypair);
  if (!wallet?.publicKey) return;

  // Allocate memory for the account
  const mintRent = await connection.getMinimumBalanceForRentExemption(
    MintLayout.span,
  );

  // Generate a mint
  const mint = anchor.web3.Keypair.generate();
  const instructions: TransactionInstruction[] = [];
  const signers: anchor.web3.Keypair[] = [mint, walletKeypair];

  instructions.push(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: mintRent,
      space: MintLayout.span,
      programId: TOKEN_PROGRAM_ID,
    }),
  );
  instructions.push(
    Token.createInitMintInstruction(
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      0,
      wallet.publicKey,
      wallet.publicKey,
    ),
  );

  const userTokenAccoutAddress = await getTokenWallet(
    wallet.publicKey,
    mint.publicKey,
  );
  instructions.push(
    createAssociatedTokenAccountInstruction(
      userTokenAccoutAddress,
      wallet.publicKey,
      wallet.publicKey,
      mint.publicKey,
    ),
  );

  // Create metadata
  const metadataAccount = await getMetadata(mint.publicKey);
  let txnData = Buffer.from(
    serialize(
      METADATA_SCHEMA,
      new CreateMetadataArgs({ data, isMutable: mutableMetadata }),
    ),
  );

  instructions.push(
    createMetadataInstruction(
      metadataAccount,
      mint.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      txnData,
    ),
  );

  instructions.push(
    Token.createMintToInstruction(
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      userTokenAccoutAddress,
      wallet.publicKey,
      [],
      1,
    ),
  );

  // Create master edition
  const editionAccount = await getMasterEdition(mint.publicKey);
  txnData = Buffer.from(
    serialize(
      METADATA_SCHEMA,
      new CreateMasterEditionArgs({ maxSupply: new anchor.BN(0) }),
    ),
  );

  instructions.push(
    createMasterEditionInstruction(
      metadataAccount,
      editionAccount,
      mint.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      wallet.publicKey,
      txnData,
    ),
  );

  const res = await sendTransactionWithRetryWithKeypair(
    connection,
    walletKeypair,
    instructions,
    signers,
  );

  try {
    await connection.confirmTransaction(res.txid, 'max');
  } catch {
    // ignore
  }

  // Force wait for max confirmations
  await connection.getParsedConfirmedTransaction(res.txid, 'confirmed');
  log.info('NFT created', res.txid);
  return metadataAccount;
};

export const updateMetadata = async (
  mintKey: PublicKey,
  connection: Connection,
  walletKeypair: Keypair,
): Promise<PublicKey | void> => {
  // Retrieve metadata
  const data = await createMetadata();
  if (!data) return;

  const metadataAccount = await getMetadata(mintKey);
  const signers: anchor.web3.Keypair[] = [];
  const value = new UpdateMetadataArgs({
    data,
    updateAuthority: walletKeypair.publicKey.toBase58(),
    primarySaleHappened: null,
  });
  const txnData = Buffer.from(serialize(METADATA_SCHEMA, value));

  const instructions = [
    createUpdateMetadataInstruction(
      metadataAccount,
      walletKeypair.publicKey,
      txnData,
    ),
  ];

  // Execute transaction
  const txid = await sendTransactionWithRetryWithKeypair(
    connection,
    walletKeypair,
    instructions,
    signers,
  );
  console.log('Metadata updated', txid);
  return metadataAccount;
};
