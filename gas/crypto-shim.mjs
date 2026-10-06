export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error('HASH_UNSUPPORTED');
  let text = '';
  return { update(value) { text += value; return this; }, digest(encoding) {
    if (encoding !== 'hex') throw new Error('HASH_ENCODING_UNSUPPORTED');
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text,
      Utilities.Charset.UTF_8).map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
  } };
}
