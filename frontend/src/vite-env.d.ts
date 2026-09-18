/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  // Add more env variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// import ไฟล์เป็นข้อความ (ใช้ในเทสต์ที่ตรวจรูปแบบโค้ด)
declare module '*?raw' {
  const content: string
  export default content
}
