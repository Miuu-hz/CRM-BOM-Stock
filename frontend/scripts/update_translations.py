import json
from pathlib import Path

WORK_ORDERS_EN = {
    "title": "Work Orders",
    "subtitle": "Manage production orders and track status",
    "createWorkOrder": "Create Work Order",
    "searchPlaceholder": "Search WO number, product, or assignee...",
    "stats": {
        "total": "Total WOs",
        "planned": "Planned",
        "inProgress": "In Progress",
        "completed": "Completed",
        "totalProduced": "Total Produced"
    },
    "table": {
        "woNumber": "WO Number",
        "product": "Product",
        "priority": "Priority",
        "status": "Status",
        "quantity": "Quantity",
        "progress": "Progress",
        "dueDate": "Due Date",
        "assignedTo": "Assigned To",
        "actions": "Actions"
    },
    "empty": "No work orders found",
    "materialsCount": "{{count}} materials",
    "confirmDelete": "Delete this work order?",
    "status": {
        "draft": "Draft",
        "planned": "Planned",
        "in_progress": "In Progress",
        "on_hold": "On Hold",
        "completed": "Completed",
        "cancelled": "Cancelled"
    },
    "priority": {
        "urgent": "Urgent",
        "high": "High",
        "normal": "Normal",
        "low": "Low"
    },
    "actions": {
        "plan": "Plan",
        "startProduction": "Start Production",
        "markComplete": "Mark Complete"
    },
    "create": {
        "title": "Create Work Order",
        "subtitle": "Select a BOM to auto-fill materials",
        "step1": "Select BOM",
        "manualEntry": "Manual entry",
        "noBOMs": "No BOMs yet — use Manual entry instead",
        "manualModeHint": "Fill in the details below manually",
        "step2": "Details",
        "productLabel": "Product Name *",
        "productPlaceholder": "Product to manufacture",
        "quantityLabel": "Quantity to Produce *",
        "priorityLabel": "Priority",
        "dueDateLabel": "Due Date",
        "assignedToLabel": "Assigned To",
        "assignedToPlaceholder": "Team / Name",
        "step3": "Materials Required",
        "stockShortage": "Shortage of {{count}} materials — click \"Create PR\" below to auto-order",
        "stockSufficient": "All materials sufficient for this production",
        "noMaterialsSelected": "Select a BOM to auto-fill or click \"+ Add\"",
        "bomNoMaterials": "This BOM has no raw materials",
        "materialPlaceholder": "Material name",
        "unitPlaceholder": "unit",
        "itemsCount": "{{count}} items",
        "notesPlaceholder": "Notes or special instructions...",
        "shortageSummary": "Shortage of <strong>{{count}}</strong> materials",
        "createPR": "Create Purchase Request Automatically",
        "bomSelected": "Using BOM: {{name}}",
        "manualEntrySelected": "Manual entry",
        "noBOMSelected": "No BOM selected",
        "createButton": "Create Work Order",
        "semiFinished": "Semi-finished",
        "prReason": "Raw material shortage for producing: {{name}} quantity {{quantity}} units",
        "prCreated": "Purchase Request created successfully — {{count}} items",
        "prFailed": "Unable to create PR"
    },
    "detail": {
        "productionProgress": "Production Progress",
        "units": "units",
        "assignedTo": "Assigned To",
        "dueDate": "Due Date",
        "estimatedCost": "Estimated Cost",
        "actualCost": "Actual Cost",
        "materialsRequired": "Materials Required",
        "materialFallback": "Material",
        "issued": "Issued: {{issued}}/{{required}} {{unit}}",
        "noMaterialsLinked": "No materials linked",
        "productionComplete": "Production Complete",
        "completedOn": "Completed on {{date}}",
        "completed": "Completed",
        "putOnHold": "Put On Hold",
        "resume": "Resume",
        "cancelOrder": "Cancel Order",
        "planProduction": "Plan Production",
        "startProduction": "Start Production",
        "markComplete": "Mark Complete"
    },
    "error": {
        "updateStatus": "Failed to update status",
        "delete": "Failed to delete",
        "create": "Failed to create work order"
    }
}

WORK_ORDERS_TH = {
    "title": "ใบสั่งงาน",
    "subtitle": "จัดการใบสั่งผลิตและติดตามสถานะ",
    "createWorkOrder": "สร้างใบสั่งงาน",
    "searchPlaceholder": "ค้นหาเลข WO, สินค้า หรือผู้รับผิดชอบ...",
    "stats": {
        "total": "WO ทั้งหมด",
        "planned": "วางแผนแล้ว",
        "inProgress": "กำลังผลิต",
        "completed": "เสร็จสิ้น",
        "totalProduced": "ผลิตรวม"
    },
    "table": {
        "woNumber": "เลขที่ WO",
        "product": "สินค้า",
        "priority": "ความสำคัญ",
        "status": "สถานะ",
        "quantity": "จำนวน",
        "progress": "ความคืบหน้า",
        "dueDate": "กำหนดเสร็จ",
        "assignedTo": "ผู้รับผิดชอบ",
        "actions": "จัดการ"
    },
    "empty": "ไม่พบใบสั่งงาน",
    "materialsCount": "{{count}} รายการวัตถุดิบ",
    "confirmDelete": "ลบใบสั่งงานนี้?",
    "status": {
        "draft": "ฉบับร่าง",
        "planned": "วางแผนแล้ว",
        "in_progress": "กำลังผลิต",
        "on_hold": "ระงับ",
        "completed": "เสร็จสิ้น",
        "cancelled": "ยกเลิก"
    },
    "priority": {
        "urgent": "ด่วนมาก",
        "high": "สูง",
        "normal": "ปกติ",
        "low": "ต่ำ"
    },
    "actions": {
        "plan": "วางแผน",
        "startProduction": "เริ่มผลิต",
        "markComplete": "บันทึกเสร็จสิ้น"
    },
    "create": {
        "title": "สร้างใบสั่งงาน",
        "subtitle": "เลือก BOM เพื่อ auto-fill วัตถุดิบ",
        "step1": "เลือก BOM",
        "manualEntry": "กรอกเอง",
        "noBOMs": "ยังไม่มี BOM — ใช้ Manual entry แทน",
        "manualModeHint": "กรอกข้อมูลเองด้านล่าง",
        "step2": "รายละเอียด",
        "productLabel": "ชื่อสินค้า *",
        "productPlaceholder": "ชื่อสินค้าที่ผลิต",
        "quantityLabel": "จำนวนผลิต *",
        "priorityLabel": "ความสำคัญ",
        "dueDateLabel": "วันกำหนดเสร็จ",
        "assignedToLabel": "ผู้รับผิดชอบ",
        "assignedToPlaceholder": "ทีม / ชื่อ",
        "step3": "วัตถุดิบที่ต้องใช้",
        "stockShortage": "ขาดวัตถุดิบ {{count}} รายการ — กดปุ่ม \"สร้าง PR\" ด้านล่างเพื่อสั่งซื้ออัตโนมัติ",
        "stockSufficient": "วัตถุดิบเพียงพอสำหรับการผลิตนี้ทั้งหมด",
        "noMaterialsSelected": "เลือก BOM เพื่อ auto-fill หรือกด \"+ เพิ่ม\"",
        "bomNoMaterials": "BOM นี้ไม่มี raw materials",
        "materialPlaceholder": "ชื่อวัตถุดิบ",
        "unitPlaceholder": "หน่วย",
        "itemsCount": "{{count}} รายการ",
        "notesPlaceholder": "หมายเหตุหรือคำสั่งพิเศษ...",
        "shortageSummary": "ขาดวัตถุดิบ <strong>{{count}}</strong> รายการ",
        "createPR": "สร้าง Purchase Request อัตโนมัติ",
        "bomSelected": "ใช้ BOM: {{name}}",
        "manualEntrySelected": "กรอกเอง",
        "noBOMSelected": "ยังไม่ได้เลือก BOM",
        "createButton": "สร้างใบสั่งงาน",
        "semiFinished": "กึ่งสำเร็จรูป",
        "prReason": "ขาดวัตถุดิบสำหรับผลิต: {{name}} จำนวน {{quantity}} หน่วย",
        "prCreated": "สร้าง Purchase Request สำเร็จ — {{count}} รายการ",
        "prFailed": "ไม่สามารถสร้าง PR ได้"
    },
    "detail": {
        "productionProgress": "ความคืบหน้าการผลิต",
        "units": "หน่วย",
        "assignedTo": "ผู้รับผิดชอบ",
        "dueDate": "วันกำหนดเสร็จ",
        "estimatedCost": "ต้นทุนประมาณการ",
        "actualCost": "ต้นทุนจริง",
        "materialsRequired": "วัตถุดิบที่ต้องใช้",
        "materialFallback": "วัตถุดิบ",
        "issued": "เบิกแล้ว: {{issued}}/{{required}} {{unit}}",
        "noMaterialsLinked": "ไม่มีวัตถุดิบที่เชื่อมโยง",
        "productionComplete": "การผลิตเสร็จสิ้น",
        "completedOn": "เสร็จสิ้นเมื่อ {{date}}",
        "completed": "เสร็จสิ้น",
        "putOnHold": "ระงับการผลิต",
        "resume": "Resume",
        "cancelOrder": "ยกเลิกคำสั่งผลิต",
        "planProduction": "วางแผนการผลิต",
        "startProduction": "เริ่มการผลิต",
        "markComplete": "บันทึกเสร็จสิ้น"
    },
    "error": {
        "updateStatus": "อัปเดตสถานะไม่สำเร็จ",
        "delete": "ลบไม่สำเร็จ",
        "create": "สร้างใบสั่งงานไม่สำเร็จ"
    }
}

QC_TH = {
    "title": "ควบคุมคุณภาพ",
    "subtitle": "ตรวจสอบคุณภาพสินค้าและบันทึกผลการตรวจ",
    "newInspection": "ตรวจใหม่",
    "tab": {
        "overview": "ภาพรวม",
        "checklists": "รายการตรวจ",
        "inspections": "การตรวจสอบ"
    },
    "status": {
        "pass": "ผ่าน",
        "fail": "ไม่ผ่าน",
        "pending": "รอดำเนินการ"
    },
    "stats": {
        "total": "ทั้งหมด",
        "passed": "ผ่าน",
        "failed": "ไม่ผ่าน",
        "pending": "รอดำเนินการ",
        "passRate": "อัตราผ่าน"
    },
    "recentInspections": "การตรวจสอบล่าสุด",
    "noInspections": "ยังไม่มีการตรวจสอบ",
    "viewResult": "ดูผล",
    "inspect": "ตรวจสอบ",
    "createChecklist": "สร้างรายการตรวจ",
    "noChecklists": "ยังไม่มีรายการตรวจ",
    "createFirstChecklist": "สร้างรายการตรวจแรก",
    "noCheckItems": "ยังไม่มีรายการตรวจย่อย",
    "itemCount": "{{count}} รายการตรวจ",
    "created": "สร้างเมื่อ",
    "inspectionHistory": "ประวัติการตรวจสอบ ({{count}})",
    "col": {
        "checklist": "รายการตรวจ",
        "productBatch": "สินค้า/Batch",
        "inspector": "ผู้ตรวจ",
        "date": "วันที่",
        "result": "ผลลัพธ์",
        "product": "สินค้า",
        "batch": "Batch",
        "manage": "จัดการ"
    },
    "editChecklist": "แก้ไขรายการตรวจ",
    "checklistName": "ชื่อรายการตรวจ",
    "checklistNamePlaceholder": "เช่น QC สินค้าสำเร็จรูป",
    "description": "รายละเอียด",
    "descriptionPlaceholder": "รายละเอียดเพิ่มเติม",
    "checkItems": "รายการตรวจย่อย",
    "addItem": "เพิ่มรายการ",
    "addFirstItem": "เพิ่มรายการตรวจย่อยแรก",
    "checkItemNamePlaceholder": "ชื่อรายการตรวจย่อย",
    "type": {
        "passfail": "ผ่าน/ไม่ผ่าน",
        "measurement": "ค่าวัด"
    },
    "expected": "ค่าที่คาดหวัง",
    "unit": "หน่วย",
    "checklistNameRequired": "กรุณาระบุชื่อรายการตรวจ",
    "checkItemNameRequired": "กรุณาระบุชื่อรายการตรวจย่อยทั้งหมด",
    "checklistCreated": "สร้างรายการตรวจแล้ว",
    "updated": "บันทึกการแก้ไขแล้ว",
    "saveError": "บันทึกไม่สำเร็จ",
    "startInspection": "เริ่มการตรวจสอบใหม่",
    "selectChecklist": "เลือกรายการตรวจ",
    "selectChecklistOption": "เลือกรายการตรวจ",
    "createChecklistFirst": "สร้างรายการตรวจก่อนในแท็บรายการตรวจ",
    "productName": "ชื่อสินค้า",
    "productNamePlaceholder": "เช่น หมอนยางพารา",
    "batch": "Batch / Lot",
    "batchPlaceholder": "เช่น LOT-001",
    "workOrderRef": "อ้างอิงใบสั่งงาน",
    "workOrderRefPlaceholder": "WO-00001",
    "inspector": "ผู้ตรวจ",
    "inspectorPlaceholder": "ชื่อผู้ตรวจ",
    "inspectionCreated": "สร้างการตรวจสอบแล้ว",
    "createError": "สร้างไม่สำเร็จ",
    "start": "เริ่ม",
    "productLabel": "สินค้า",
    "batchLabel": "Batch",
    "inspectorLabel": "ผู้ตรวจ",
    "pendingCount": "รอดำเนินการ",
    "target": "เป้าหมาย",
    "actualValue": "ค่าจริง",
    "notesPlaceholder": "หมายเหตุ (optional)",
    "summaryNotes": "หมายเหตุสรุป",
    "summaryNotesPlaceholder": "สรุปผลการตรวจสอบ",
    "pendingConfirm": "ยังมีรายการที่รอดำเนินการ ต้องการส่งหรือไม่?",
    "resultPass": "ผ่าน",
    "resultFail": "ไม่ผ่าน",
    "completeError": "บันทึกผลไม่สำเร็จ",
    "saveResult": "บันทึกผลการตรวจสอบ",
    "loadError": "โหลดข้อมูลไม่สำเร็จ",
    "confirmDeleteChecklist": "ลบรายการตรวจนี้?",
    "confirmDeleteInspection": "ลบการตรวจสอบนี้?",
    "deleted": "ลบแล้ว",
    "items": "รายการ",
    "result": {
        "pass": "ผ่าน",
        "fail": "ไม่ผ่าน"
    }
}

def load_json(path: Path) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(path: Path, data: dict) -> None:
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

def main():
    base = Path('/opt/crm/frontend/src/i18n/locales')
    en_path = base / 'en' / 'translation.json'
    th_path = base / 'th' / 'translation.json'

    en = load_json(en_path)
    th = load_json(th_path)

    # English: add workOrders before qc
    if 'workOrders' not in en:
        new_en = {}
        for k, v in en.items():
            if k == 'qc':
                new_en['workOrders'] = WORK_ORDERS_EN
            new_en[k] = v
        en = new_en

    # Thai: add workOrders and qc before purchaseOrders
    if 'workOrders' not in th or 'qc' not in th:
        new_th = {}
        for k, v in th.items():
            if k == 'purchaseOrders':
                if 'workOrders' not in th:
                    new_th['workOrders'] = WORK_ORDERS_TH
                if 'qc' not in th:
                    new_th['qc'] = QC_TH
            new_th[k] = v
        if 'workOrders' not in new_th:
            new_th['workOrders'] = WORK_ORDERS_TH
        if 'qc' not in new_th:
            new_th['qc'] = QC_TH
        th = new_th

    save_json(en_path, en)
    save_json(th_path, th)
    print('Translations updated successfully.')

if __name__ == '__main__':
    main()
