const dir = "/test";
const encoded = Buffer.from(dir).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(encoded);
