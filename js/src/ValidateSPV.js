/* global BigInt */

/**
 *
 * @file Part of the [bitcoin-spv]{@link https://github.com/summa-tx/bitcoin-spv} project
 *
 * @title ValidateSPV
 * @summary Validate Bitcoin SPV proofs
 * @author James Prestwich <james@summa.one>
 * @author Erin Hales <erin@summa.one>
 * @author Dominique Liau <dominique@summa.one>
 * @copyright (c) [Summa]{@link https://summa.one} 2019
 * @module ValidateSPV
 *
 */

import * as BTCUtils from './BTCUtils';
import * as utils from './utils';


/**
 *
 * Validates a tx inclusion in the block.
 * Note that `index` is not a reliable indicator of location within a block.
 *
 * @param {Uint8Array}    txid The txid (LE)
 * @param {Uint8Array}    merkleRoot The merkle root (as in the block header)
 * @param {Uint8Array}    intermediateNodes The proof's intermediate nodes
 *                        (digests between leaf and root)
 * @param {number}        index The leaf's index in the tree (0-indexed)
 * @returns {boolean}     true if fully valid, false otherwise
 */
export function prove(txid, merkleRoot, intermediateNodes, index) {
  // Shortcut the empty-block case
  if (utils.typedArraysAreEqual(txid, merkleRoot)
      && index === 0
      && intermediateNodes.length === 0) {
    return true;
  }

  const proof = utils.concatUint8Arrays(txid, intermediateNodes, merkleRoot);
  // If the Merkle proof failed, bubble up error
  return BTCUtils.verifyHash256Merkle(proof, index);
}

/**
 *
 * Hashes transaction to get txid
 *
 * @dev                   Supports LEGACY and WITNESS
 * @param {Uint8Array}    version 4-bytes version
 * @param {Uint8Array}    vin Raw bytes length-prefixed input vector
 * @param {Uint8Array}    vout Raw bytes length-prefixed output vector
 * @param {Uint8Array}    locktime 4-byte tx locktime
 * @returns {Uint8Array}  32-byte transaction id, little endian
 */
export function calculateTxId(version, vin, vout, locktime) {
  return BTCUtils.hash256(
    utils.concatUint8Arrays(version, vin, vout, locktime)
  );
}

/**
 *
 * Checks validity of header work
 *
 * @param {Uint8Array}    digest Header digest
 * @param {Uint8Array}    target The target threshold
 * @returns {Boolean}     True if header work is valid, false otherwise
 */
export function validateHeaderWork(digest, target) {
  if (utils.typedArraysAreEqual(digest, new Uint8Array(Array(32).fill(0)))) {
    return false;
  }
  return utils.bytesToUint(utils.reverseEndianness(digest)) < target;
}

/**
 *
 * Checks validity of header chain
 *
 * @dev                   Compares current header prevHashLE to previous header's digest
 * @param {Uint8Array}    header The raw bytes header
 * @param {Uint8Array}    prevHeaderDigest The previous header's digest
 * @returns {Boolean}     True if header chain is valid, false otherwise
 */
export function validateHeaderPrevHashLE(header, prevHeaderDigest) {
  // Extract prevHash of current header
  const prevHashLE = BTCUtils.extractPrevBlockLE(header);

  // Compare prevHash of current header to previous header's digest
  if (!utils.typedArraysAreEqual(prevHashLE, prevHeaderDigest)) {
    return false;
  }

  return true;
}

/**
 *
 * Checks validity of header chain
 *
 * @dev                   Compares the hash of each header to the prevHash in the next header
 * @param {Uint8Array}    headers Raw byte array of header chain
 * @returns {BigInt}      The total accumulated difficulty of the header chain, or an error code
 * @throws {TypeError}    When passed a chain that contains junk data
 * @throws {Error}        When passed an invalid chain, or header with low work
*/
export function validateHeaderChain(headers) {
  // Check header chain length
  if (headers.length % 80 !== 0) {
    throw new TypeError('Header bytes not multiple of 80.');
  }

  let digest;
  let totalDifficulty = BigInt(0);

  for (let i = 0; i < headers.length / 80; i += 1) {
    // ith header start index and ith header
    const start = i * 80;
    const header = utils.safeSlice(headers, start, start + 80);

    // After the first header, check that headers are in a chain
    if (i !== 0) {
      if (!validateHeaderPrevHashLE(header, digest)) {
        throw new Error('Header bytes not a valid chain.');
      }
    }

    // ith header target
    const target = BTCUtils.extractTarget(header);

    // Require that the header has sufficient work
    digest = BTCUtils.hash256(header);
    if (!validateHeaderWork(digest, target)) {
      throw new Error('Header does not meet its own difficulty target.');
    }

    totalDifficulty += BTCUtils.calculateDifficulty(target);
  }
  return totalDifficulty;
}

/**
 *
 * Checks validity of an entire bitcoin header
 *
 * @dev                   Checks that each element in a bitcoin header is valid
 * @param {Object}        header A valid Bitcoin header object, see README for
 *                          more information on creating an Bitcoin Header object
 * @param {Uint8Array}    header.raw The bitcoin header
 * @param {Uint8Array}    header.hash The hash of the header
 * @param {Uint8Array}    header.hash_le The LE hash of the header
 * @param {Number}        header.height The height
 * @param {Uint8Array}    header.merkle_root The merkle root of the header
 * @param {Uint8Array}    header.merkle_root_le The LE merkle root
 * @param {Uint8Array}    header.prevhash The hash of the previous header
 * @param {Uint8Array}    header.prevhash_le The LE hash of the previous header
 * @returns {Boolean}     True if the header object is syntactically valid
 * @throws {Error}        If any of the bitcoin header elements are invalid
*/
export function validateHeader(header) {
  // Check that HashLE is the correct hash of the raw header
  const headerHash = BTCUtils.hash256(header.raw);
  if (!utils.typedArraysAreEqual(headerHash, header.hash_le)) {
    throw new Error('HashLE is not the correct hash of the header');
  }

  // Check that HashLE is the reverse of Hash
  const reversedHash = utils.reverseEndianness(header.hash);
  if (!utils.typedArraysAreEqual(reversedHash, header.hash_le)) {
    throw new Error('HashLE is not the LE version of Hash');
  }

  // Check that the MerkleRootLE is the correct MerkleRoot for the header
  const extractedMerkleRootLE = BTCUtils.extractMerkleRootLE(header.raw);
  if (!utils.typedArraysAreEqual(extractedMerkleRootLE, header.merkle_root_le)) {
    throw new Error('MerkleRootLE is not the correct merkle root of the header');
  }

  // Check that MerkleRootLE is the reverse of MerkleRoot
  const reversedMerkleRoot = utils.reverseEndianness(header.merkle_root);
  if (!utils.typedArraysAreEqual(reversedMerkleRoot, header.merkle_root_le)) {
    throw new Error('MerkleRootLE is not the LE version of MerkleRoot');
  }

  // Check that PrevHash is the correct PrevHash for the header
  const extractedPrevHash = BTCUtils.extractPrevBlockLE(header.raw);
  if (!utils.typedArraysAreEqual(extractedPrevHash, header.prevhash_le)) {
    throw new Error('PrevhashLE is not the correct parent hash of the header');
  }

  // Check that PrevhashLE is the reverse of Prevhash
  const reversedPrevhash = utils.reverseEndianness(header.prevhash);
  if (!utils.typedArraysAreEqual(reversedPrevhash, header.prevhash_le)) {
    throw new Error('PrevhashLE is not the LE version of Prevhash');
  }

  return true;
}

/**
 *
 * Checks validity of an entire SPV Proof
 *
 * @dev                   Checks that each element in an SPV Proof is valid
 * @param {Object}        proof A valid SPV Proof object, see README for
 *                          more information on creating an SPV Proof object
 * @param {Uint8Array}    proof.version The version
 * @param {Uint8Array}    proof.vin The vin
 * @param {Uint8Array}    proof.vout The vout
 * @param {Uint8Array}    proof.locktime The locktime
 * @param {Uint8Array}    proof.tx_id The tx ID
 * @param {Uint8Array}    proof.tx_id_le The LE tx ID
 * @param {Number}        proof.index The index
 * @param {Uint8Array}    proof.intermediate_nodes The intermediate nodes
 * @param {Uint8Array}    proof.confirming_header.raw The bitcoin header
 * @param {Uint8Array}    proof.confirming_header.hash The hash of the header
 * @param {Uint8Array}    proof.confirming_header.hash_le The LE hash of the header
 * @param {Number}        proof.confirming_header.height The height
 * @param {Uint8Array}    proof.confirming_header.merkle_root The merkle root of the header
 * @param {Uint8Array}    proof.confirming_header.merkle_root_le The LE merkle root
 * @param {Uint8Array}    proof.confirming_header.prevhash The hash of the previous header
 * @param {Uint8Array}    proof.confirming_header.prevhash_le The LE hash of the previous header
 * @returns {Boolean}     Returns true if the SPV Proof object is syntactically valid
 * @throws {Error}        If any of the SPV Proof elements are invalid
*/
export function validateProof(proof) {
  const {
    version,
    vin,
    vout,
    locktime,
    tx_id_le: txIdLE,
    index,
    intermediate_nodes: intermediateNodes,
    confirming_header: confirmingHeader
  } = proof;
  const { merkle_root_le: merkleRootLE } = confirmingHeader;

  const validVin = BTCUtils.validateVin(vin);
  if (!validVin) {
    throw new Error('Vin is not valid');
  }

  const validVout = BTCUtils.validateVout(vout);
  if (!validVout) {
    throw new Error('Vout is not valid');
  }

  const txID = calculateTxId(version, vin, vout, locktime);
  if (!utils.typedArraysAreEqual(txID, txIdLE)) {
    throw new Error('Version, Vin, Vout and Locktime did not yield correct TxID');
  }

  validateHeader(confirmingHeader);

  const validProof = prove(txIdLE, merkleRootLE, intermediateNodes, index);
  if (!validProof) {
    throw new Error('Merkle Proof is not valid');
  }

  return true;
}
