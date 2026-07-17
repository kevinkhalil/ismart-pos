import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import PostalMime from "postal-mime";
import OpenAI from "openai";

const azureAI = new OpenAI({ baseURL: process.env.AZURE_AI_ENDPOINT, apiKey: process.env.AZURE_AI_API_KEY });

const QUOTATION_KEYWORDS = [
  "quote", "quotation", "price", "pricing", "how much", "cost",
  "inquiry", "enquiry", "i need", "i want", "interested in",
  "available", "stock", "purchase", "buy", "order",
];

function looksLikeQuotationRequest(subject, bodyText) {
  const haystack = `${subject} ${bodyText}`.toLowerCase();
  return QUOTATION_KEYWORDS.some(kw => haystack.includes(kw));
}

function makeImapClient() {
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.SUPPORT_EMAIL,
      pass: process.env.SUPPORT_EMAIL_PASSWORD,
    },
    logger: false,
  });
}

function makeTransporter() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SUPPORT_EMAIL,
      pass: process.env.SUPPORT_EMAIL_PASSWORD,
    },
  });
}

async function extractItems(emailText, products) {
  const productList = products
    .map(p => `ID:${p.id} | ${p.name} | Price:$${p.sellPrice.toFixed(2)} | ${p.stock > 0 ? `In stock (${p.stock})` : "Out of stock"}`)
    .join("\n");

  const response = await azureAI.responses.create({
    model: process.env.AZURE_AI_DEPLOYMENT,
    input: `You are a quotation assistant for a smartphone shop. Extract items from this customer email and match them to the product catalog.

EMAIL:
"""
${emailText.slice(0, 3000)}
"""

PRODUCT CATALOG:
${productList}

Instructions:
- Extract the customer's name (use "Valued Customer" if not found)
- Set isQuotationRequest to true only if the customer is asking for prices or a quotation
- Match each requested item to the closest product in the catalog (by name similarity)
- Items with no reasonable match go in unmatchedItems
- Extract quantities (default 1 if not stated)
- Copy unitPrice exactly from the catalog

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "customerName": "string",
  "isQuotationRequest": boolean,
  "items": [
    { "productId": number, "productName": "string", "quantity": number, "unitPrice": number, "inStock": boolean }
  ],
  "unmatchedItems": ["string"]
}`,
  });

  return JSON.parse(response.output_text);
}

// The AI only decides *which* product an item matches — price, name, and stock
// always come from the real catalog, never from what the model echoed back.
function reconcileWithCatalog(items, unmatchedItems, products) {
  const byId = new Map(products.map(p => [p.id, p]));
  const verifiedItems = [];
  const verifiedUnmatched = [...(unmatchedItems || [])];

  for (const item of items || []) {
    const product = byId.get(item.productId);
    if (!product) {
      verifiedUnmatched.push(item.productName || `Unrecognized item (id ${item.productId})`);
      continue;
    }
    verifiedItems.push({
      productId:   product.id,
      productName: product.name,
      quantity:    item.quantity > 0 ? item.quantity : 1,
      unitPrice:   product.sellPrice,
      inStock:     product.stock > 0,
    });
  }

  return { items: verifiedItems, unmatchedItems: verifiedUnmatched };
}

function buildPDF({ quotationNumber, date, customerName, items, unmatchedItems }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const company   = process.env.COMPANY_NAME || "iSmart";
    const blue      = "#2563eb";
    const slate     = "#64748b";
    const lightGray = "#f1f5f9";
    const dark      = "#1e293b";

    // ── Header ──────────────────────────────────────────
    doc.fontSize(24).fillColor(blue).text(company, 50, 50);
    doc.fontSize(10).fillColor(slate).text("Smartphone & Accessories", 50, 80);
    doc.fontSize(20).fillColor(dark).text("QUOTATION", 400, 50, { align: "right" });
    doc.fontSize(10).fillColor(slate)
      .text(`Ref: ${quotationNumber}`, 400, 76, { align: "right" })
      .text(`Date: ${date}`,           400, 91, { align: "right" });

    doc.moveTo(50, 114).lineTo(545, 114).strokeColor(blue).lineWidth(2).stroke();

    // ── Bill To ─────────────────────────────────────────
    doc.fontSize(9).fillColor(slate).text("PREPARED FOR:", 50, 128);
    doc.fontSize(13).fillColor(dark).text(customerName, 50, 143);

    // ── Table header ────────────────────────────────────
    const tY = 185;
    doc.rect(50, tY, 495, 22).fill(blue);
    doc.fontSize(9).fillColor("white")
      .text("#",       58,  tY + 7)
      .text("Item",    78,  tY + 7)
      .text("Qty",    360,  tY + 7, { width: 50,  align: "right" })
      .text("Unit",   410,  tY + 7, { width: 68,  align: "right" })
      .text("Total",  480,  tY + 7, { width: 62,  align: "right" });

    let y = tY + 22;
    let grandTotal = 0;

    items.forEach((item, i) => {
      const lineTotal = item.unitPrice * item.quantity;
      grandTotal += lineTotal;
      doc.rect(50, y, 495, 22).fill(i % 2 === 0 ? "white" : lightGray);
      const textColor = item.inStock ? dark : "#ef4444";
      const label = item.productName + (item.inStock ? "" : " ⚠ Out of stock");
      doc.fontSize(9).fillColor(textColor)
        .text(String(i + 1),                 58, y + 6)
        .text(label,                         78, y + 6, { width: 275 })
        .text(String(item.quantity),        360, y + 6, { width: 50,  align: "right" })
        .text(`$${item.unitPrice.toFixed(2)}`, 410, y + 6, { width: 68, align: "right" })
        .text(`$${lineTotal.toFixed(2)}`,   480, y + 6, { width: 62,  align: "right" });
      y += 22;
    });

    // ── Grand total row ──────────────────────────────────
    doc.rect(50, y, 495, 26).fill(blue);
    doc.fontSize(11).fillColor("white")
      .text("GRAND TOTAL",               360, y + 8, { width: 172, align: "right" })
      .text(`$${grandTotal.toFixed(2)}`, 480, y + 8, { width: 62,  align: "right" });
    y += 26;

    // ── Unmatched items note ─────────────────────────────
    if (unmatchedItems?.length) {
      y += 14;
      doc.fontSize(9).fillColor("#ef4444")
        .text(
          `Items not found in current inventory: ${unmatchedItems.join(", ")}`,
          50, y, { width: 495 }
        );
      y += 20;
    }

    // ── Footer ───────────────────────────────────────────
    const footY = Math.max(y + 40, 700);
    doc.moveTo(50, footY).lineTo(545, footY).strokeColor(lightGray).lineWidth(1).stroke();
    doc.fontSize(8).fillColor(slate)
      .text(
        "This quotation is valid for 7 days from the date of issue. Prices are subject to change without notice.",
        50, footY + 10, { align: "center", width: 495 }
      )
      .text(`Contact: ${process.env.SUPPORT_EMAIL}`, 50, footY + 22, { align: "center", width: 495 });

    doc.end();
  });
}

let quotationAgentRunning = false;

export async function runQuotationAgent(prisma) {
  if (!process.env.SUPPORT_EMAIL || !process.env.SUPPORT_EMAIL_PASSWORD) {
    console.warn("[QuotationAgent] SUPPORT_EMAIL or SUPPORT_EMAIL_PASSWORD not set — skipping.");
    return;
  }

  if (quotationAgentRunning) {
    console.log("[QuotationAgent] Previous run still in progress — skipping this poll.");
    return;
  }
  quotationAgentRunning = true;
  try {
    await processInbox(prisma);
  } finally {
    quotationAgentRunning = false;
  }
}

async function processInbox(prisma) {
  const client = makeImapClient();
  client.on("error", err => console.error("[QuotationAgent] IMAP socket error:", err.message));

  try {
    await client.connect();
  } catch (err) {
    console.error("[QuotationAgent] IMAP connect failed:", err.message);
    return;
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids.length) {
        console.log("[QuotationAgent] No new emails.");
        return;
      }
      console.log(`[QuotationAgent] ${uids.length} unseen email(s) found.`);

      const raw = await prisma.product.findMany({
        select: {
          id: true, name: true, sellPrice: true,
          quantity: true, isSerialized: true,
          units: { where: { status: "in_stock" }, select: { id: true } },
        },
      });
      const products = raw.map(p => ({
        id:        p.id,
        name:      p.name,
        sellPrice: p.sellPrice,
        stock:     p.isSerialized ? p.units.length : p.quantity,
      }));

      const transporter = makeTransporter();

      for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
        const fromAddr = msg.envelope?.from?.[0]?.address;
        const subject  = msg.envelope?.subject || "(no subject)";

        if (!fromAddr) {
          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
          continue;
        }

        // Parse email body
        let bodyText = "";
        try {
          const parsed = await PostalMime.parse(msg.source);
          bodyText = parsed.text || parsed.html?.replace(/<[^>]+>/g, " ") || "";
        } catch {
          bodyText = msg.source.toString("utf-8").slice(0, 3000);
        }

        // Cheap keyword check before spending an API call
        if (!looksLikeQuotationRequest(subject, bodyText)) {
          console.log(`[QuotationAgent] Skipping non-quotation email from ${fromAddr}: "${subject}"`);
          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
          continue;
        }

        console.log(`[QuotationAgent] Processing: "${subject}" from ${fromAddr}`);

        let extracted;
        try {
          extracted = await extractItems(bodyText, products);
          const reconciled = reconcileWithCatalog(extracted.items, extracted.unmatchedItems, products);
          extracted.items = reconciled.items;
          extracted.unmatchedItems = reconciled.unmatchedItems;
        } catch (err) {
          console.error(`[QuotationAgent] AI extraction failed for ${fromAddr}:`, err.message);
          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
          continue;
        }

        if (!extracted.isQuotationRequest || !extracted.items?.length) {
          console.log(`[QuotationAgent] Not a quotation request — skipping.`);
          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
          continue;
        }

        const quotationNumber = `QT-${Date.now()}`;
        const date = new Date().toLocaleDateString("en-GB", {
          day: "2-digit", month: "long", year: "numeric",
        });

        let pdf;
        try {
          pdf = await buildPDF({
            quotationNumber,
            date,
            customerName: extracted.customerName,
            items:         extracted.items,
            unmatchedItems: extracted.unmatchedItems,
          });
        } catch (err) {
          console.error("[QuotationAgent] PDF build failed:", err.message);
          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
          continue;
        }

        try {
          await transporter.sendMail({
            from: `"${process.env.COMPANY_NAME || "iSmart"}" <${process.env.SUPPORT_EMAIL}>`,
            to:   fromAddr,
            subject: `Re: ${subject} — Quotation ${quotationNumber}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1e293b">
                <h2 style="color:#2563eb">Dear ${extracted.customerName},</h2>
                <p>Thank you for your enquiry! Please find your price quotation attached to this email.</p>
                ${extracted.unmatchedItems?.length
                  ? `<p style="color:#ef4444">⚠ The following items were not found in our current inventory:
                     <strong>${extracted.unmatchedItems.join(", ")}</strong>.
                     Please contact us directly for alternatives or further assistance.</p>`
                  : ""}
                <p>This quotation is valid for <strong>7 days</strong> from today.</p>
                <p>If you have any questions, simply reply to this email — we're happy to help.</p>
                <br>
                <hr style="border:none;border-top:1px solid #e2e8f0">
                <p style="color:#64748b;font-size:12px">
                  ${process.env.COMPANY_NAME || "iSmart"} — Customer Support<br>
                  ${process.env.SUPPORT_EMAIL}
                </p>
              </div>`,
            attachments: [{
              filename:    `Quotation-${quotationNumber}.pdf`,
              content:     pdf,
              contentType: "application/pdf",
            }],
          });
          console.log(`[QuotationAgent] Quotation ${quotationNumber} sent to ${fromAddr}`);
        } catch (err) {
          console.error(`[QuotationAgent] Failed to send to ${fromAddr}:`, err.message);
        }

        // Always mark read to avoid reprocessing on next poll
        await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
