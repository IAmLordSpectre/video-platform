const request = require("supertest");
const { app, server } = require("../server");

afterAll((done) => {
  server.close(done);
});

describe("GET /", () => {
  it("returns 200 and a health message", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Video API is running/i);
  });
});
