import { Router, Request, Response } from 'express'
import prisma from '../db/prisma'

const router = Router()

/**
 * GET /api/data/products
 * ดึงรายการสินค้าทั้งหมด
 */
router.get('/products', async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
    })

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
router.get('/materials', async (req: Request, res: Response) => {
  try {
    const materials = await prisma.material.findMany({
      orderBy: { name: 'asc' },
    })

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
router.get('/boms', async (req: Request, res: Response) => {
  try {
    const boms = await prisma.bOM.findMany({
      include: {
        product: true,
        materials: {
          include: {
            material: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    // Enrich BOM with calculated data
    const enrichedBOMs = boms.map((bom) => {
      const bomMaterials = bom.materials.map((bomMat) => ({
        ...bomMat,
        materialName: bomMat.material.name,
        materialCode: bomMat.material.code,
        unitCost: Number(bomMat.material.unitCost),
      }))

      const totalCost = bomMaterials.reduce((sum, mat) => {
        return sum + Number(mat.quantity) * mat.unitCost
      }, 0)

      return {
        ...bom,
        productName: bom.product.name,
        productCode: bom.product.code,
        materials: bomMaterials,
        totalCost,
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
router.get('/boms/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params

    const bom = await prisma.bOM.findFirst({
      where: {
        productId,
        status: 'ACTIVE',
      },
      include: {
        product: true,
        materials: {
          include: {
            material: true,
          },
        },
      },
    })

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found for this product',
      })
    }

    const bomMaterials = bom.materials.map((bomMat) => ({
      ...bomMat,
      materialName: bomMat.material.name,
      materialCode: bomMat.material.code,
      unitCost: Number(bomMat.material.unitCost),
    }))

    const totalCost = bomMaterials.reduce((sum, mat) => {
      return sum + Number(mat.quantity) * mat.unitCost
    }, 0)

    res.json({
      success: true,
      data: {
        ...bom,
        productName: bom.product.name,
        productCode: bom.product.code,
        materials: bomMaterials,
        totalCost,
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
