import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const tokenPath = join(homedir(), ".max", "api-token");
    const token = readFileSync(tokenPath, "utf-8").trim();
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ token: null, error: "Token file not found" }, { status: 404 });
  }
}
