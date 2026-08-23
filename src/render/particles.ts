export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
}

export class ParticleSystem {
  private particles: Particle[] = []

  get count(): number {
    return this.particles.length
  }

  burst(x: number, y: number, color: string, count = 12, speed = 120) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const v = speed * (0.3 + Math.random() * 0.7)
      const life = 0.3 + Math.random() * 0.5
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - 60,
        life,
        maxLife: life,
        color,
      })
    }
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 400 * dt
      p.life -= dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500)
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife)
      ctx.fillStyle = p.color
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
    }
    ctx.globalAlpha = 1
  }

  clear() {
    this.particles = []
  }
}
