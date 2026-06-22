/**
 * Audit.gs — PDPA access logging (Proposal §11)
 * ------------------------------------------------------------------
 * Every meaningful Action is appended to AUDIT_LOG. Workbook 1 has its
 * own AUDIT_LOG; the confidential HR workbook (Workbook 2) has a
 * separate one so HR access trails stay isolated with the HR data.
 *
 * AUDIT_LOG columns: Timestamp, UserID, Action, TableName, RecordID
 * ------------------------------------------------------------------
 */

/** Log to Workbook 1 (school data) AUDIT_LOG. Never throws. */
function logAudit(userId, action, tableName, recordId) {
  _logAuditTo_(getMainSpreadsheet_(), userId, action, tableName, recordId);
}

/** Log to Workbook 2 (HR — confidential) AUDIT_LOG. Never throws. */
function logAuditHr(userId, action, tableName, recordId) {
  _logAuditTo_(getHrSpreadsheet_(), userId, action, tableName, recordId);
}

function _logAuditTo_(ss, userId, action, tableName, recordId) {
  try {
    appendObject_(sheet_(ss, 'AUDIT_LOG'), {
      Timestamp: new Date(),
      UserID:    userId || 'anonymous',
      Action:    action || '',
      TableName: tableName || '',
      RecordID:  recordId || ''
    });
  } catch (e) {
    // Auditing must never break the primary request; surface in logs only.
    Logger.log('AUDIT FAIL: ' + e.message);
  }
}
