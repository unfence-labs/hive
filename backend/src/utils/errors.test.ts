import { describe, expect, it } from "vitest";
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  errorMessage,
  errorStatus,
} from "./errors.js";

describe("errorMessage", () => {
  it("returns Error.message for Error instances", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("returns fallback for non-Error values", () => {
    expect(errorMessage("boom", "fallback")).toBe("fallback");
    expect(errorMessage({ message: "boom" }, "fallback")).toBe("fallback");
  });

  it("returns fallback for nullish values", () => {
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
    expect(errorMessage(null, "fallback")).toBe("fallback");
  });
});

describe("AppError hierarchy", () => {
  it("assigns status code and code", () => {
    const err = new AppError("x", 418, "teapot");
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("teapot");
  });

  it("maps known subclasses to expected status", () => {
    expect(new BadRequestError("x").statusCode).toBe(400);
    expect(new UnauthorizedError("x").statusCode).toBe(401);
    expect(new NotFoundError("x").statusCode).toBe(404);
    expect(new ConflictError("x").statusCode).toBe(409);
    expect(new TooManyRequestsError("x").statusCode).toBe(429);
  });
});

describe("errorStatus", () => {
  it("returns status for AppError", () => {
    expect(errorStatus(new NotFoundError("missing"))).toBe(404);
  });

  it("returns fallback for unknown errors", () => {
    expect(errorStatus(new Error("boom"), 500)).toBe(500);
    expect(errorStatus("boom", 500)).toBe(500);
  });
});
