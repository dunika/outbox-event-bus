export default {
  datasource: {
    url:
      process.env.DATABASE_URL ?? "postgresql://test_user:test_password@localhost:5434/outbox_test",
  },
}
