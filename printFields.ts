import { STRATEGY_FIELDS } from './utils/tokenUtils';

async function main() {

  console.log('STRATEGY_FIELDS = [');
  for (const field of STRATEGY_FIELDS) {
    console.log(`  { key: '${field.key}', label: '${field.label}', type: '${field.type}', optional: ${field.optional} },`);
  }
  console.log('];');
}

main();
