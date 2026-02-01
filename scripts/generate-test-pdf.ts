import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CONTRACTS = {
  'vattenfall-energy': {
    title: 'Stromlieferungsvertrag',
    lines: [
      'Vertragsnummer: VF-2025-00471',
      '',
      'Vertragspartner:',
      'Vattenfall Europe Sales GmbH',
      'Überseering 12, 22297 Hamburg',
      '',
      'Kunde:',
      'Max Mustermann',
      'Musterstraße 42, 10115 Berlin',
      '',
      'Tarifbezeichnung: Natur24 Strom',
      'Vertragsbeginn: 01.03.2025',
      'Vertragsende: 28.02.2027',
      'Mindestvertragslaufzeit: 24 Monate',
      '',
      'Preisübersicht:',
      'Grundpreis (monatlich): 12,50 EUR',
      'Arbeitspreis (brutto): 0,3295 EUR/kWh',
      'Geschätzter Jahresverbrauch: 3.500 kWh',
      '',
      'Kündigungsfrist: 6 Wochen zum Vertragsende',
      '',
      'Zahlungsweise: Monatliche Abschlagszahlung',
      'Monatlicher Abschlag: 108,27 EUR',
      '',
      'Stromkennzeichnung: 100% erneuerbare Energien',
      '',
      'Besondere Vereinbarungen:',
      'Preisgarantie bis 28.02.2026 (eingeschränkt,',
      'ausgenommen Steuern, Abgaben und Umlagen).',
      '',
      'Widerrufsrecht: 14 Tage ab Vertragsschluss.',
      '',
      'Hamburg, den 15.01.2025',
      '',
      '____________________________',
      'Vattenfall Europe Sales GmbH',
    ],
  },
  'telekom-telco': {
    title: 'Mobilfunkvertrag',
    lines: [
      'Vertragsnummer: DT-2025-83201',
      '',
      'Anbieter:',
      'Deutsche Telekom AG',
      'Friedrich-Ebert-Allee 140, 53113 Bonn',
      '',
      'Kunde:',
      'Erika Musterfrau',
      'Beispielweg 7, 80331 München',
      '',
      'Tarifbezeichnung: MagentaMobil L',
      'Vertragsbeginn: 15.04.2025',
      'Vertragsende: 14.04.2027',
      'Mindestvertragslaufzeit: 24 Monate',
      '',
      'Leistungsübersicht:',
      'Monatlicher Grundpreis: 49,95 EUR',
      'Datenvolumen: 50 GB (LTE/5G)',
      'Telefonie: Flatrate ins deutsche Festnetz & Mobilfunk',
      'SMS: Flatrate',
      'EU-Roaming: inklusive',
      '',
      'Kündigungsfrist: 3 Monate zum Vertragsende',
      '',
      'Zahlungsweise: Monatliche Abbuchung (SEPA)',
      '',
      'Bonn, den 01.04.2025',
      '',
      '____________________________',
      'Deutsche Telekom AG',
    ],
  },
  'allianz-insurance': {
    title: 'Versicherungsschein — Hausratversicherung',
    lines: [
      'Versicherungsschein-Nr.: ALZ-HR-2025-55102',
      '',
      'Versicherer:',
      'Allianz Versicherungs-AG',
      'Königinstraße 28, 80802 München',
      '',
      'Versicherungsnehmer:',
      'Thomas Beispiel',
      'Lindenstraße 15, 50674 Köln',
      '',
      'Versicherungsart: Hausratversicherung',
      'Versicherungsbeginn: 01.06.2025',
      'Versicherungsende: 31.05.2026',
      'Vertragslaufzeit: 1 Jahr (automatische Verlängerung)',
      '',
      'Versicherungssumme: 65.000,00 EUR',
      'Selbstbeteiligung: 250,00 EUR pro Schadensfall',
      'Monatlicher Beitrag: 18,90 EUR',
      'Jährlicher Beitrag: 226,80 EUR',
      '',
      'Leistungsumfang:',
      '- Feuer, Einbruchdiebstahl, Leitungswasser, Sturm/Hagel',
      '- Überspannungsschäden durch Blitz',
      '- Fahrraddiebstahl (Nachtzeitklausel aufgehoben)',
      '',
      'Kündigungsfrist: 3 Monate zum Vertragsende',
      '',
      'München, den 20.05.2025',
      '',
      '____________________________',
      'Allianz Versicherungs-AG',
    ],
  },
};

async function generatePdf(name: string, title: string, lines: string[]): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]); // A4

  const fontSize = 11;
  const titleSize = 16;
  let y = 790;

  // Title
  page.drawText(title, { x: 50, y, font: boldFont, size: titleSize });
  y -= 30;

  // Horizontal line
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1 });
  y -= 20;

  for (const line of lines) {
    if (y < 50) break;
    if (line === '') {
      y -= 10;
      continue;
    }
    page.drawText(line, { x: 50, y, font, size: fontSize });
    y -= 16;
  }

  const pdfBytes = await doc.save();
  const outPath = resolve('test/fixtures', `${name}.pdf`);
  await writeFile(outPath, pdfBytes);
  console.log(`Created: ${outPath}`);
}

async function main(): Promise<void> {
  for (const [name, { title, lines }] of Object.entries(CONTRACTS)) {
    await generatePdf(name, title, lines);
  }
}

main().catch(console.error);
