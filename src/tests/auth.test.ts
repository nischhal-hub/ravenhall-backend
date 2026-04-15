import request from "supertest";
import app from "../app";
import { prisma } from "../config/database";

beforeAll(async () => {
  // Clean test users
  await prisma.user.deleteMany({ where: { email: { contains: "@test-suite.com" } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: "@test-suite.com" } } });
  await prisma.$disconnect();
});

describe("POST /api/auth/register", () => {
  it("should register a new user", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "newuser@test-suite.com",
      password: "Test@1234",
      firstName: "Test",
      lastName: "User",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.data.email).toBe("newuser@test-suite.com");
  });

  it("should reject duplicate email", async () => {
    await request(app).post("/api/auth/register").send({
      email: "duplicate@test-suite.com",
      password: "Test@1234",
      firstName: "Test",
      lastName: "User",
    });
    const res = await request(app).post("/api/auth/register").send({
      email: "duplicate@test-suite.com",
      password: "Test@1234",
      firstName: "Test",
      lastName: "User",
    });
    expect(res.status).toBe(409);
  });

  it("should reject weak password", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "weak@test-suite.com",
      password: "weak",
      firstName: "Test",
      lastName: "User",
    });
    expect(res.status).toBe(422);
  });
});

describe("POST /api/auth/login", () => {
  it("should reject invalid credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "notexists@test-suite.com",
      password: "WrongPass@1",
    });
    expect(res.status).toBe(401);
  });
});
