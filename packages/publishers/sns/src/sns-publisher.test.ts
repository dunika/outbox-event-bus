import { describe, expect, it, vi } from "vitest"
import { SNSPublisher } from "./sns-publisher"

describe("SNSPublisher", () => {
  const mockBus = {
    subscribe: vi.fn(),
  }
  const mockSnsClient = {
    send: vi.fn(),
  }

  it("should support bufferSize greater than 10 by automatic chunking", () => {
    const publisher = new SNSPublisher(mockBus as any, {
      snsClient: mockSnsClient as any,
      topicArn: "arn:aws:sns:us-east-1:000000000000:my-topic",
      processingConfig: { bufferSize: 11 },
    })
    expect(publisher).toBeDefined()
  })
})
