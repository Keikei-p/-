"use strict";
/**
 * IMMUTABLE CATEGORY CONTRACT ONLY — STAGING / NO DEPLOY.
 *
 * The canonical ranking source reads ../functions-partner-workspace/service.cjs
 * solely to verify the nine legacy partner categories. Packaging the original
 * 49 KB write-capable partner workspace service inside a count-only ranking
 * Function would unnecessarily expose write paths and break isolation.
 *
 * This module deliberately exports ONLY the nine immutable category labels.
 * CI MUST compare them against the real original service.cjs KEYS every PR;
 * drift blocks the deployment candidate. No Firestore, Auth, IO or writes.
 */
const KEYS=Object.freeze([
 "NURO","SBMNP","YMMNP","YM純新規","SB光・AIR",
 "ウォーター","つばさ・HTB","太陽光・蓄電池AP","U-NEXT"
]);
module.exports=Object.freeze({KEYS});
