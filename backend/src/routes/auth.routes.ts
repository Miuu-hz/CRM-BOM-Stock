import { Router, Request, Response } from 'express'

const router = Router()

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    // TODO: Implement actual authentication
    // For now, return mock response
    if (email === 'admin@example.com' && password === 'admin123') {
      res.json({
        success: true,
        message: 'Login successful',
        data: {
          token: 'mock-jwt-token',
          user: {
            id: '1',
            email: 'admin@example.com',
            name: 'Admin User',
            role: 'ADMIN',
          },
        },
      })
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      })
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login failed',
    })
  }
})

// Register
router.post('/register', async (req: Request, res: Response) => {
  try {
    // TODO: Implement user registration
    res.json({
      success: true,
      message: 'User registered successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Registration failed',
    })
  }
})

export default router
