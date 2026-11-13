import path from 'path'
import PDFDocument from 'pdfkit'
import type { Response } from 'express'

// __dirname อยู่ลึกเท่ากันทั้ง src/services/hr และ dist/services/hr
const FONT_DIR = path.join(__dirname, '../../../assets/fonts')
const MARGIN = 56

export interface PdfInput {
  title: string
  companyName: string
  bodyText: string
  signatures: string[]
}

/**
 * pdfkit ตัดบรรทัดที่ช่องว่างเท่านั้น ภาษาไทยแทบไม่มีช่องว่าง จึงตัดคำด้วย Intl.Segmenter (granularity: 'word')
 * และต่อคำเข้าบรรทัดแบบ greedy ตามความกว้างที่วัดได้ หากคำเดียวยาวเกิน maxWidth จะตัดทีละอักขระ
 */
export function wrapThai(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const segmenter = new (Intl as any).Segmenter('th', { granularity: 'word' })
  const paragraphs = text.split(/\r?\n/)
  const lines: string[] = []

  for (const para of paragraphs) {
    if (!para) {
      lines.push('')
      continue
    }

    let currentLine = ''
    const pushPiece = (piece: string) => {
      if (!piece) return
      if (!currentLine) {
        if (measure(piece) <= maxWidth) {
          currentLine = piece
        } else {
          for (const ch of piece) {
            if (!currentLine) {
              currentLine = ch
            } else if (measure(currentLine + ch) <= maxWidth) {
              currentLine += ch
            } else {
              lines.push(currentLine)
              currentLine = ch
            }
          }
        }
        return
      }

      const combined = currentLine + piece
      if (measure(combined) <= maxWidth) {
        currentLine = combined
      } else {
        lines.push(currentLine)
        currentLine = ''
        if (measure(piece) <= maxWidth) {
          currentLine = piece
        } else {
          for (const ch of piece) {
            if (!currentLine) {
              currentLine = ch
            } else if (measure(currentLine + ch) <= maxWidth) {
              currentLine += ch
            } else {
              lines.push(currentLine)
              currentLine = ch
            }
          }
        }
      }
    }

    for (const { segment } of segmenter.segment(para)) {
      pushPiece(segment)
    }

    if (currentLine) {
      lines.push(currentLine)
    }
  }

  return lines
}

// Alias for backwards compatibility
export const wrapText = wrapThai

export function renderPdf(input: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: { Title: input.title },
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.registerFont('regular', path.join(FONT_DIR, 'Sarabun-Regular.ttf'))
    doc.registerFont('bold', path.join(FONT_DIR, 'Sarabun-Bold.ttf'))

    const width = doc.page.width - MARGIN * 2

    if (input.companyName) {
      doc.font('bold').fontSize(14).text(input.companyName, { align: 'center', width })
      doc.moveDown(0.5)
    }
    if (input.title) {
      doc.font('bold').fontSize(18).text(input.title, { align: 'center', width })
      doc.moveDown(1)
    }

    doc.font('regular').fontSize(12)
    const lines = wrapThai(input.bodyText, width, s => doc.widthOfString(s))
    for (const line of lines) {
      if (doc.y + doc.currentLineHeight(true) > doc.page.height - MARGIN) {
        doc.addPage()
      }
      if (line) {
        doc.text(line, MARGIN, doc.y, { width, lineBreak: false })
      }
      doc.moveDown(line ? 1 : 0.7)
    }

    for (const sig of input.signatures) {
      if (doc.y + 60 > doc.page.height - MARGIN) {
        doc.addPage()
      }
      doc.moveDown(1.5)
      doc.text('ลงชื่อ ................................................', { align: 'right', width })
      doc.text(`(${sig})`, { align: 'right', width })
    }

    doc.end()
  })
}

export function sendPdf(res: Response, buf: Buffer, filename: string) {
  const cleanName = filename.replace(/\.pdf$/i, '')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(cleanName)}.pdf`)
  res.send(buf)
}
