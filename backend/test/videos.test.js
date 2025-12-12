const request = require("supertest");
const { app, server } = require("../server");

afterAll((done) => {
  server.close(done);
});

describe("GET /videos", () => {
  it("returns JSON (200 if Cosmos configured, 500 if not)", async () => {
    const res = await request(app).get("/videos");
    expect([200, 500]).toContain(res.statusCode);

    if (res.statusCode === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    } else {
      expect(res.body).toHaveProperty("error");
    }
  });
});
