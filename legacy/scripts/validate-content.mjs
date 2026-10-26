#!/usr/bin/env node
import {readFileSync} from "node:fs";
const source=process.argv[2];
if(!source){console.error("Usage: node scripts/validate-content.mjs <local-json-file>");process.exit(2);}
let payload;
try {payload=JSON.parse(readFileSync(source,"utf8"));}catch(error){console.error("Cannot read local JSON:",error.message);process.exit(2);}
const sections=Array.isArray(payload)?payload:payload.sections;
if(!Array.isArray(sections)){console.error("Missing sections array");process.exit(2);}
const errors=[];
let previous=0;
for (const [index,section] of sections.entries()){
  const no=Number(section.number ?? section.sort_order);
  if(!Number.isInteger(no)||no<=previous) errors.push(`Section ${index+1}: invalid or out-of-order number`);
  previous=no;
  const original=String(section.secondary_text ?? section.arabic_source ?? "").trim();
  const romanized=String(section.text_content ?? section.transliteration ?? "").trim();
  const meaning=String(section.translation ?? "").trim();
  if(!original || !/[\u0600-\u06ff]/u.test(original)) errors.push(`Section ${no}: original text missing`);
  if(!romanized) errors.push(`Section ${no}: romanization missing`);
  if(!meaning) errors.push(`Section ${no}: meaning missing`);
  if(original && /[\uFFFD]/u.test(original)) errors.push(`Section ${no}: damaged original text`);
  if(meaning && /[\uFFFD]/u.test(meaning)) errors.push(`Section ${no}: damaged translated text`);
  if(section.arabic_verified===false || section.translation_verified===false) errors.push(`Section ${no}: source not verified`);
}
console.log(JSON.stringify({sections:sections.length,valid:errors.length===0,errorCount:errors.length,errors:errors.slice(0,35)},null,2));
if(errors.length)process.exitCode=1;
