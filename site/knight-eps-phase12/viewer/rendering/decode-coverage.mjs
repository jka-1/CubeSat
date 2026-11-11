// Browsers may transparently decode a gzip Content-Encoding response.
export async function decodeGzip(bytes){
 const header=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
 return header[0]===0x1f&&header[1]===0x8b
  ?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  :bytes;
}
export async function decodeCoverage(bytes,expectedLength){
 const decoded=await decodeGzip(bytes);
 if(decoded.byteLength!==expectedLength)throw Error('Incomplete artwork package');
 return decoded;
}
