import {readFile,writeFile} from 'node:fs/promises';
import {releaseSnapshot} from './release-snapshot.mjs';
if(!process.argv[2] || !process.argv[3])throw new Error('Expected input and output paths');
await writeFile(process.argv[3],JSON.stringify(releaseSnapshot(JSON.parse(await readFile(process.argv[2],'utf8'))))+'\n');
