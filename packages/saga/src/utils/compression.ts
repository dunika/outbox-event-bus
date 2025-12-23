import { promisify } from "node:util"
import { deflate, inflate } from "node:zlib"

const deflateAsync = promisify(deflate)
const inflateAsync = promisify(inflate)

export async function compress(data: string): Promise<string> {
  const buffer = await deflateAsync(Buffer.from(data))
  return buffer.toString("base64")
}

export async function decompress(data: string): Promise<string> {
  const buffer = await inflateAsync(Buffer.from(data, "base64"))
  return buffer.toString("utf8")
}
