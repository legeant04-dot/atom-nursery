/**
 * Dspm_Seed.gs — DSPM_CRITERIA data loading note
 * ------------------------------------------------------------------
 * The real criteria are now extracted from the ministry manual summary
 * tables (PDF pages 79-83) into:  dspm_ocr/DSPM_CRITERIA_draft.csv
 * (139 items, columns aligned to SCHEMA[WB.MAIN].DSPM_CRITERIA cols 1-9).
 *
 * ⚠️ That CSV is a DRAFT. Per the school's requirement (clinical data,
 * must be exact), proofread it against dspm_ocr/pages/page-0NN.png —
 * pay attention to rows with NeedsReview=Y — THEN paste columns
 * AgeFrom..Track into the DSPM_CRITERIA sheet. Method/PassCriteria can
 * be filled from the detail pages (13-78) during proofreading.
 *
 * Seed is intentionally empty so setupAll() never loads unverified
 * clinical data automatically.
 * ------------------------------------------------------------------
 */
var DSPM_CRITERIA_SEED = [];
