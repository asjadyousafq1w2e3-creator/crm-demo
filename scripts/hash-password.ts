/**
 * Generate the ADMIN_PASSWORD_HASH value.
 *
 *   npm run hash:password -- 'the password'
 *
 * The plaintext is never written anywhere - it is read from argv, hashed, and discarded.
 */
import { hashPassword } from "../lib/auth";

const password = process.argv[2];
if (!password) {
  console.error("usage: npm run hash:password -- '<password>'");
  process.exit(1);
}
console.log(hashPassword(password));
