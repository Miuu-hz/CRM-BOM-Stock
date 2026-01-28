import { Router, Request, Response } from 'express'
import * as productRepo from '../repositories/product.repository'
import * as materialRepo from '../repositories/material.repository'
import * as bomRepo from '../repositories/bom.repository'

const router = Router()

/**
 * GET /api/data/products
 * ดึงรายการสินค้าทั้งหมด
 */
router.get('/products', (req: Request, res: Response) => {
  try {
    const products = productRepo.getAllProducts()
    res.json({
      success: true,
      data: products,
    })
  } catch (error) {
    console.error('Get products error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
    })
  }
})

/**
 * GET /api/data/materials
 * ดึงรายการวัตถุดิบทั้งหมด
 */
router.get('/materials', (req: Request, res: Response) => {
  try {
    const materials = materialRepo.getAllMaterials()
    res.json({
      success: true,
      data: materials,
    })
  } catch (error) {
    console.error('Get materials error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch materials',
    })
  }
})

/**
 * GET /api/data/boms
 * ดึงรายการ BOM ทั้งหมด
 */
router.get('/boms', (req: Request, res: Response) => {
  try {
    const boms = bomRepo.getAllBOMs()

    // Enrich BOM with calculated data
    const enrichedBOMs = boms.map((bom: any) => {
      const bomMaterials = (bom.materials || []).map((bomMat: any) => ({
        ...bomMat,
        materialName: bomMat.material?.name,
        materialCode: bomMat.material?.code,
        unitCost: bomMat.material?.unitCost,
      }))

      return {
        ...bom,
        productName: bom.product?.name,
        productCode: bom.product?.code,
        materials: bomMaterials,
      }
    })

    res.json({
      success: true,
      data: enrichedBOMs,
    })
  } catch (error) {
    console.error('Get BOMs error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch BOMs',
    })
  }
})

/**
 * GET /api/data/boms/:productId
 * ดึง BOM ของสินค้าเฉพาะ
 */
router.get('/boms/:productId', (req: Request, res: Response) => {
  try {
    const { productId } = req.params

    const bom = bomRepo.getBOMByProductId(productId, 'ACTIVE')

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found for this product',
      })
    }

    const bomMaterials = (bom.materials || []).map((bomMat: any) => ({
      ...bomMat,
      materialName: bomMat.material?.name,
      materialCode: bomMat.material?.code,
      unitCost: bomMat.material?.unitCost,
    }))

    res.json({
      success: true,
      data: {
        ...bom,
        materials: bomMaterials,
      },
    })
  } catch (error) {
    console.error('Get BOM by product error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch BOM',
    })
  }
})

export default router
