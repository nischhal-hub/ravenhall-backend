import request from "supertest";
import app from "../app";
import { prisma } from "../config/database";
import { useTestDatabase } from "./setup/database";

// Real local test DB, emptied before this suite runs
useTestDatabase();

afterAll(async () => { await prisma.$disconnect(); });

describe("GET /api/lanes", () => {
  it("should return list of active lanes", async () => {
    const res = await request(app).get("/api/lanes");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    // Paginated since 7bd4272: { lanes, meta }
    expect(Array.isArray(res.body.data.lanes)).toBe(true);
    expect(res.body.data.meta).toEqual(
      expect.objectContaining({ total: expect.any(Number) }),
    );
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

describe("GET /api/lanes/availability", () => {
  it("should require a date", async () => {
    const res = await request(app).get("/api/lanes/availability");
    expect(res.status).toBe(400);
  });

  it("should reject a malformed date", async () => {
    const res = await request(app).get("/api/lanes/availability?date=tomorrow");
    expect(res.status).toBe(400);
  });

  it("should reject an unknown lane type", async () => {
    const res = await request(app).get(
      "/api/lanes/availability?date=2030-01-01&type=SWIMMING",
    );
    expect(res.status).toBe(400);
  });

  it("should return no lanes for a date in the past", async () => {
    const res = await request(app).get("/api/lanes/availability?date=2000-01-01");
    expect(res.status).toBe(200);
    expect(res.body.data.lanes).toEqual([]);
  });
});
