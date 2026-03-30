// Hero Canvas Animation - Animated Grid with Particles
class HeroAnimation {
    constructor() {
        this.canvas = document.getElementById('heroCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.gridLines = [];
        this.mouse = { x: 0, y: 0 };
        this.particleCount = 50;

        this.init();
        this.setupEventListeners();
    }

    init() {
        this.resize();
        this.createParticles();
        this.createGridLines();
        this.animate();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.resize();
            this.createGridLines();
        });

        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
        });
    }

    createParticles() {
        this.particles = [];
        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                alpha: Math.random() * 0.5 + 0.2
            });
        }
    }

    createGridLines() {
        this.gridLines = [];
        const gridSpacing = 80;

        // Vertical lines
        for (let x = 0; x < this.canvas.width; x += gridSpacing) {
            this.gridLines.push({
                type: 'vertical',
                position: x,
                offset: Math.random() * Math.PI * 2
            });
        }

        // Horizontal lines
        for (let y = 0; y < this.canvas.height; y += gridSpacing) {
            this.gridLines.push({
                type: 'horizontal',
                position: y,
                offset: Math.random() * Math.PI * 2
            });
        }
    }

    drawGrid() {
        const time = Date.now() * 0.001;

        this.gridLines.forEach(line => {
            const wave = Math.sin(time + line.offset) * 0.3 + 0.3;
            this.ctx.strokeStyle = `rgba(59, 130, 246, ${wave * 0.1})`;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();

            if (line.type === 'vertical') {
                this.ctx.moveTo(line.position, 0);
                this.ctx.lineTo(line.position, this.canvas.height);
            } else {
                this.ctx.moveTo(0, line.position);
                this.ctx.lineTo(this.canvas.width, line.position);
            }

            this.ctx.stroke();
        });
    }

    drawParticles() {
        this.particles.forEach(particle => {
            // Update position
            particle.x += particle.vx;
            particle.y += particle.vy;

            // Bounce off edges
            if (particle.x < 0 || particle.x > this.canvas.width) particle.vx *= -1;
            if (particle.y < 0 || particle.y > this.canvas.height) particle.vy *= -1;

            // Mouse interaction
            const dx = this.mouse.x - particle.x;
            const dy = this.mouse.y - particle.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 150) {
                const force = (150 - distance) / 150;
                particle.x -= dx * force * 0.01;
                particle.y -= dy * force * 0.01;
            }

            // Draw particle
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(59, 130, 246, ${particle.alpha})`;
            this.ctx.fill();

            // Draw connections
            this.particles.forEach(otherParticle => {
                const dx = particle.x - otherParticle.x;
                const dy = particle.y - otherParticle.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 120) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(particle.x, particle.y);
                    this.ctx.lineTo(otherParticle.x, otherParticle.y);
                    const alpha = (1 - distance / 120) * 0.2;
                    this.ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                }
            });
        });
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.drawGrid();
        this.drawParticles();

        requestAnimationFrame(() => this.animate());
    }
}

// Scroll Animations
class ScrollAnimations {
    constructor() {
        this.elements = document.querySelectorAll('.fade-in');
        this.init();
    }

    init() {
        this.observe();
        window.addEventListener('scroll', () => this.checkVisibility());
        this.checkVisibility(); // Check on load
    }

    observe() {
        const options = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, options);

        this.elements.forEach(element => {
            observer.observe(element);
        });
    }

    checkVisibility() {
        this.elements.forEach(element => {
            const rect = element.getBoundingClientRect();
            const windowHeight = window.innerHeight;

            if (rect.top < windowHeight * 0.9) {
                element.classList.add('visible');
            }
        });
    }
}

// Smooth Scroll
class SmoothScroll {
    constructor() {
        this.init();
    }

    init() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                const href = anchor.getAttribute('href');

                // Skip if it's just "#"
                if (href === '#') return;

                e.preventDefault();

                const target = document.querySelector(href);
                if (target) {
                    const offsetTop = target.offsetTop - 80; // Account for fixed nav

                    window.scrollTo({
                        top: offsetTop,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }
}

// Nav Background on Scroll
class NavController {
    constructor() {
        this.nav = document.querySelector('.nav');
        this.init();
    }

    init() {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                this.nav.style.background = 'rgba(10, 10, 15, 0.95)';
            } else {
                this.nav.style.background = 'rgba(10, 10, 15, 0.8)';
            }
        });
    }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new HeroAnimation();
    new ScrollAnimations();
    new SmoothScroll();
    new NavController();
});

// Add a subtle parallax effect to hero content
window.addEventListener('scroll', () => {
    const scrolled = window.scrollY;
    const heroContent = document.querySelector('.hero-content');

    if (heroContent && scrolled < window.innerHeight) {
        heroContent.style.transform = `translateY(${scrolled * 0.3}px)`;
        heroContent.style.opacity = 1 - (scrolled / window.innerHeight) * 0.8;
    }
});
