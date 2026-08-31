import { TokenService } from "../src/modules/auth/token.service";

/** Prints an RS256 PEM pair for JWT_PRIVATE_KEY / JWT_PUBLIC_KEY. */
async function main() {
  const { privateKey, publicKey } = await TokenService.generatePemPair();
  process.stdout.write(
    `JWT_PRIVATE_KEY="${privateKey.trimEnd().replace(/\n/g, "\n")}"\n\n` +
      `JWT_PUBLIC_KEY="${publicKey.trimEnd().replace(/\n/g, "\n")}"\n`,
  );
}

void main();
