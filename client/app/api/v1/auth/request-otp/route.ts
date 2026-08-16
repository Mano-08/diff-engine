import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

function isAllowedEmailDomain(email: string): boolean {
  const allowedEntries = (process.env.ALLOWED_EMAIL_DOMAIN ?? "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const emailLc = email.toLowerCase();
  return allowedEntries.some((entry) => emailLc.endsWith(entry));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { email } = body as { email?: string };

    if (!email || typeof email !== "string") {
      return NextResponse.json({
        message: "email is needed",
        status: 400,
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isAllowedEmailDomain(normalizedEmail)) {
      return NextResponse.json({
        status: 403,
        error: "Please sign in with your company email address.",
      });
    }

    const res = await fetch(`${API_BASE}/api/v1/auth/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    console.log(res);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to get code");
    }

    console.log(res, "refRFFE");

    const responseData = await res.json().catch(() => {});
    console.log(responseData, "RFFE");
    const { code } = responseData;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,

      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,

      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Clueso Docs" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Your sign-in code",
      text: `Your verification code is ${code}. It expires in ${process.env.OTP_EXPIRY_MINUTES} minutes.`,
      html: `<p>Your verification code is:</p><h2 style="letter-spacing:4px">${code}</h2><p>This code expires in ${process.env.OTP_EXPIRY_MINUTES} minutes.</p>`,
    });

    return NextResponse.json({ status: 201 });
  } catch (error) {
    console.log(error, "5000>>>>>>>>>>>");
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 500 },
    );
  }
}
