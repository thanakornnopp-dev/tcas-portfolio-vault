/**
 * =========================================================================
 * ระบบจัดเก็บและสำรองข้อมูลพอร์ตโฟลิโอ TCAS ลง Google Drive (Code.gs)
 * สำหรับ: นายธีทัต นพรัตน์ (Theetat Nopparat)
 * พัฒนาโดย: Thanaporn Nopparat (Faculty of Engineering, Thammasat University)
 * =========================================================================
 * 
 * วิธีการติดตั้งบน Google Apps Script:
 * 1. เปิด Google Drive -> กด "+ ใหม่" -> เลือก "Google Apps Script"
 * 2. นำโค้ดในไฟล์นี้ไปวางแทนที่โค้ดเดิมทั้งหมดใน Code.gs
 * 3. นำโค้ดในไฟล์ index.html ไปสร้างไฟล์ HTML ชื่อ "Index" (หากต้องการรันเป็น Web App เต็มรูปแบบ)
 * 4. ใส่ Folder ID ของ Google Drive ที่ต้องการให้เก็บไฟล์ลงใน TARGET_FOLDER_ID ด้านล่าง
 * 5. กดปุ่ม "ทำให้ใช้งานได้ (Deploy)" -> "การทำให้ใช้งานได้รายการใหม่ (New Deployment)" 
 *    -> เลือกประเภท "เว็บแอปพลิเคชัน (Web App)" 
 *    -> Execute as: Me (ฉัน) | Who has access: Anyone (ทุกคนที่มีลิงก์)
 * 6. คัดลอก URL เว็บแอปที่ได้มาใส่ในช่อง "Google Apps Script Web App URL" บนหน้าเว็บ
 */

// โฟลเดอร์ปลายทางใน Google Drive สำหรับเก็บข้อมูลพอร์ตของน้องธีทัต
// (หากปล่อยว่าง ระบบจะสร้างโฟลเดอร์ชื่อ 'TCAS_Portfolio_ธีทัต_นพรัตน์' ให้อัตโนมัติบน My Drive)
const TARGET_FOLDER_ID = "1XivRFrJKQhmQTmqBHG1kczbz4rgvDAZ9"; 
const PORTFOLIO_OWNER = "นายธีทัต นพรัตน์";
const BACKUP_JSON_NAME = "portfolio_theetat_backup.json";

/**
 * ฟังก์ชันหลักเปิด Web App
 */
function doGet(e) {
  // หากมีพารามิเตอร์ ?action=get_data ให้ส่งข้อมูล JSON กลับ
  if (e && e.parameter && e.parameter.action === 'get_data') {
    const data = getPortfolioData();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // แสดงหน้าเว็บ Index.html
  try {
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('TCAS Portfolio Hub | นายธีทัต นพรัตน์')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'Google Apps Script Backend สำหรับพอร์ตโฟลิโอของธีทัต นพรัตน์ พร้อมทำงาน',
      owner: PORTFOLIO_OWNER,
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * รับคำขอ POST จากเว็บแอปเพื่อซิงค์ข้อมูลหรืออัปโหลดไฟล์
 */
function doPost(e) {
  try {
    let requestData;
    if (e.postData && e.postData.contents) {
      requestData = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      requestData = e.parameter;
    } else {
      throw new Error('ไม่พบข้อมูลส่งมา (No request body)');
    }

    const action = requestData.action || 'sync_portfolio';

    if (action === 'sync_portfolio') {
      const result = savePortfolioData(requestData.items, requestData.profileMeta);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'บันทึกข้อมูลพอร์ตโฟลิโอลง Google Drive สำเร็จ',
        savedAt: new Date().toLocaleString('th-TH'),
        folderUrl: result.folderUrl
      })).setMimeType(ContentService.MimeType.JSON);
    } 
    else if (action === 'upload_proof_file') {
      const uploadResult = uploadProofFile(requestData);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'อัปโหลดไฟล์หลักฐานขึ้น Google Drive เรียบร้อย',
        fileUrl: uploadResult.fileUrl,
        fileName: uploadResult.fileName
      })).setMimeType(ContentService.MimeType.JSON);
    }

    throw new Error('ไม่รู้จักคำสั่ง action: ' + action);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ดึงหรือสร้างโฟลเดอร์จัดเก็บของน้องธีทัตบน Google Drive
 */
function getTargetFolder() {
  if (TARGET_FOLDER_ID && TARGET_FOLDER_ID.trim() !== "") {
    try {
      return DriveApp.getFolderById(TARGET_FOLDER_ID.trim());
    } catch(e) {
      Logger.log("ไม่พบ Folder ID ที่ระบุ กำลังสร้างโฟลเดอร์ใหม่บน Drive...");
    }
  }

  const folderName = "TCAS_Portfolio_ธีทัต_นพรัตน์";
  const existing = DriveApp.getFoldersByName(folderName);
  if (existing.hasNext()) {
    return existing.next();
  }
  return DriveApp.createFolder(folderName);
}

/**
 * บันทึกข้อมูลพอร์ตทั้งหมดเป็นไฟล์ JSON ลงในโฟลเดอร์ Google Drive
 */
function savePortfolioData(items, profileMeta) {
  const folder = getTargetFolder();
  const payload = {
    owner: PORTFOLIO_OWNER,
    lastUpdated: new Date().toISOString(),
    profile: profileMeta || {},
    items: items || []
  };

  const jsonString = JSON.stringify(payload, null, 2);

  // ตรวจสอบว่ามีไฟล์เดิมอยู่หรือไม่ ถ้ามีให้ลบแล้วเขียนใหม่
  const existingFiles = folder.getFilesByName(BACKUP_JSON_NAME);
  while (existingFiles.hasNext()) {
    existingFiles.next().setTrashed(true);
  }

  const blob = Utilities.newBlob(jsonString, 'application/json', BACKUP_JSON_NAME);
  const createdFile = folder.createFile(blob);
  createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    status: 'success',
    fileId: createdFile.getId(),
    fileUrl: createdFile.getUrl(),
    folderUrl: folder.getUrl()
  };
}

/**
 * อัปโหลดไฟล์หลักฐาน/เกียรติบัตร (Base64) ลงในโฟลเดอร์ Certificates บน Google Drive
 */
function uploadProofFile(data) {
  if (!data.fileData) throw new Error('ไม่พบข้อมูลไฟล์ base64');

  const mainFolder = getTargetFolder();
  
  // โฟลเดอร์ย่อยสำหรับเกียรติบัตรและหลักฐาน
  let certFolder;
  const subFolders = mainFolder.getFoldersByName('Certificates_และเอกสารแนบ');
  if (subFolders.hasNext()) {
    certFolder = subFolders.next();
  } else {
    certFolder = mainFolder.createFolder('Certificates_และเอกสารแนบ');
  }

  const contentType = data.fileType || 'application/pdf';
  const decodedBytes = Utilities.base64Decode(data.fileData);
  
  const cleanTitle = (data.itemTitle || 'Certificate')
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 50);

  const fileName = `${data.itemCategory || 'Doc'}_${cleanTitle}_${new Date().getTime()}.${data.fileExt || 'pdf'}`;
  
  const blob = Utilities.newBlob(decodedBytes, contentType, fileName);
  const file = certFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    status: 'success',
    fileName: fileName,
    fileId: file.getId(),
    fileUrl: file.getUrl()
  };
}

/**
 * ดึงข้อมูลพอร์ตล่าสุดจากไฟล์ JSON ใน Google Drive
 */
function getPortfolioData() {
  try {
    const folder = getTargetFolder();
    const files = folder.getFilesByName(BACKUP_JSON_NAME);
    if (files.hasNext()) {
      const file = files.next();
      const content = file.getBlob().getDataAsString();
      return JSON.parse(content);
    }
  } catch(e) {
    Logger.log("Error reading data from Drive: " + e.toString());
  }
  return { owner: PORTFOLIO_OWNER, items: [], profile: {} };
}
