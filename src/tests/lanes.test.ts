import request from "supertest";
import app from "../app";
import { prisma } from "../config/database";

afterAll(async () => { await prisma.$disconnect(); });

describe("GET /api/lanes", () => {
  it("should return list of active lanes", async () => {
    const res = await request(app).get("/api/lanes");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("GET /api/lanes/:id/slots", () => {
  it("should require date parameter", async () => {
    const lanes = await prisma.lane.findFirst({ where: { isActive: true } });
    if (!lanes) return;
    const res = await request(app).get(`/api/lanes/${lanes.id}/slots`);
    expect(res.status).toBe(400);
  });
});
