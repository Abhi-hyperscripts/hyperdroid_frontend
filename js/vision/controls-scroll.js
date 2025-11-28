/**
 * Meeting Controls Scroll Handler
 * Smooth infinite circular scrolling like a conveyor belt
 * Similar to CRED Clone circular navigation
 */

class ControlsScroller {
    constructor(selector) {
        this.container = document.querySelector(selector);

        if (!this.container) {
            console.warn('ControlsScroller: Container not found');
            return;
        }

        this.track = null;
        this.isDragging = false;
        this.startX = 0;
        this.currentTranslate = 0;
        this.prevTranslate = 0;
        this.velocity = 0;
        this.animationID = 0;
        this.lastX = 0;
        this.lastTime = 0;
        this.originalButtons = [];
        this.itemWidth = 0;
        this.totalItems = 0;

        this.init();
    }

    init() {
        // Create track wrapper
        this.createTrack();

        // Clone buttons for infinite scroll
        this.cloneButtons();

        // Calculate item width
        this.calculateItemWidth();

        // Set initial position to middle set (after 2 clone sets)
        this.currentTranslate = -this.itemWidth * 2;
        this.prevTranslate = this.currentTranslate;
        this.updateTrackPosition(false);

        console.log('Initial translate:', this.currentTranslate);

        // Mouse events for desktop
        this.container.addEventListener('mousedown', (e) => this.handleDragStart(e));
        this.container.addEventListener('mousemove', (e) => this.handleDragMove(e));
        this.container.addEventListener('mouseup', () => this.handleDragEnd());
        this.container.addEventListener('mouseleave', () => this.handleDragEnd());

        // Touch events for mobile
        this.container.addEventListener('touchstart', (e) => this.handleDragStart(e), { passive: true });
        this.container.addEventListener('touchmove', (e) => this.handleDragMove(e), { passive: true });
        this.container.addEventListener('touchend', () => this.handleDragEnd());

        // Prevent default drag on child elements
        this.container.addEventListener('dragstart', (e) => e.preventDefault());

        // Mouse wheel scrolling
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Invert deltaY for natural scrolling direction
            this.currentTranslate -= e.deltaY;
            this.prevTranslate = this.currentTranslate;
            this.updateTrackPosition(false);
            this.checkInfiniteLoop();
        }, { passive: false });

        // Prevent clicks when dragging
        this.container.addEventListener('click', (e) => {
            if (this.isDragging || Math.abs(this.velocity) > 1) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    createTrack() {
        // Create a track wrapper div
        this.track = document.createElement('div');
        this.track.className = 'controls-track';
        this.track.style.display = 'flex';
        this.track.style.gap = '12px';
        this.track.style.alignItems = 'center';
        this.track.style.willChange = 'transform';

        // Move all children to track
        while (this.container.firstChild) {
            this.track.appendChild(this.container.firstChild);
        }

        // Add track to container
        this.container.appendChild(this.track);

        // Update container styles
        this.container.style.overflow = 'hidden';
        this.container.style.position = 'relative';
    }

    cloneButtons() {
        // Get all original control buttons from track
        this.originalButtons = Array.from(this.track.children);
        this.totalItems = this.originalButtons.length;

        if (this.totalItems === 0) return;

        // Create multiple clones for smoother infinite scroll (2 sets on each side)
        const clonesBefore1 = this.originalButtons.map(btn => btn.cloneNode(true));
        const clonesBefore2 = this.originalButtons.map(btn => btn.cloneNode(true));
        const clonesAfter1 = this.originalButtons.map(btn => btn.cloneNode(true));
        const clonesAfter2 = this.originalButtons.map(btn => btn.cloneNode(true));

        // Add class markers
        clonesBefore1.forEach(btn => btn.classList.add('clone-before-1'));
        clonesBefore2.forEach(btn => btn.classList.add('clone-before-2'));
        clonesAfter1.forEach(btn => btn.classList.add('clone-after-1'));
        clonesAfter2.forEach(btn => btn.classList.add('clone-after-2'));

        // Add clones before original buttons (reverse order, furthest first)
        clonesBefore2.reverse().forEach(clone => {
            this.track.insertBefore(clone, this.track.firstChild);
        });
        clonesBefore1.reverse().forEach(clone => {
            this.track.insertBefore(clone, this.track.firstChild);
        });

        // Add clones after original buttons
        clonesAfter1.forEach(clone => {
            this.track.appendChild(clone);
        });
        clonesAfter2.forEach(clone => {
            this.track.appendChild(clone);
        });

        // Re-attach event listeners to cloned buttons
        this.reattachButtonEvents();
    }

    calculateItemWidth() {
        // Calculate total width of one complete set
        let totalWidth = 0;
        this.originalButtons.forEach((btn, index) => {
            totalWidth += btn.offsetWidth;
            if (index < this.originalButtons.length - 1) {
                totalWidth += 12; // Add gap except for last item
            }
        });

        // Average item width including gaps
        this.itemWidth = totalWidth;

        console.log('Total items:', this.totalItems);
        console.log('Item width (full set):', this.itemWidth);
    }

    reattachButtonEvents() {
        // Get all buttons (including clones)
        const allButtons = this.track.querySelectorAll('.control-btn');

        allButtons.forEach((btn, index) => {
            // Find the original button index
            const originalIndex = index % this.totalItems;
            const originalBtn = this.originalButtons[originalIndex];

            // Copy onclick handler if it exists
            if (originalBtn.onclick) {
                btn.onclick = originalBtn.onclick;
            }

            // Copy all attributes except class
            const attrs = originalBtn.attributes;
            for (let i = 0; i < attrs.length; i++) {
                if (attrs[i].name !== 'class') {
                    btn.setAttribute(attrs[i].name, attrs[i].value);
                }
            }
        });
    }

    updateTrackPosition(animated = true) {
        if (animated) {
            this.track.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        } else {
            this.track.style.transition = 'none';
        }
        this.track.style.transform = `translateX(${this.currentTranslate}px)`;
    }

    checkInfiniteLoop() {
        // We have: [Clone2][Clone1][Original][Clone1][Clone2]
        // Start at position -itemWidth * 2 (showing original)
        // When we reach -itemWidth * 3, we've moved one set right, jump back
        // When we reach -itemWidth * 1, we've moved one set left, jump forward

        const oneSetWidth = this.itemWidth;

        // Scrolling right (negative values increasing)
        if (this.currentTranslate <= -oneSetWidth * 3) {
            this.track.style.transition = 'none';
            this.currentTranslate = -oneSetWidth * 2;
            this.prevTranslate = this.currentTranslate;
            this.track.style.transform = `translateX(${this.currentTranslate}px)`;
            console.log('Loop right: Reset to', this.currentTranslate);
        }
        // Scrolling left (negative values decreasing)
        else if (this.currentTranslate >= -oneSetWidth * 1) {
            this.track.style.transition = 'none';
            this.currentTranslate = -oneSetWidth * 2;
            this.prevTranslate = this.currentTranslate;
            this.track.style.transform = `translateX(${this.currentTranslate}px)`;
            console.log('Loop left: Reset to', this.currentTranslate);
        }
    }

    handleDragStart(e) {
        this.isDragging = true;
        this.container.style.cursor = 'grabbing';
        this.container.style.userSelect = 'none';

        const touch = e.type.includes('mouse') ? e : e.touches[0];
        this.startX = touch.clientX;
        this.lastX = touch.clientX;
        this.lastTime = Date.now();
        this.velocity = 0;

        // Stop any ongoing momentum
        cancelAnimationFrame(this.animationID);

        // Remove transition for smooth dragging
        this.track.style.transition = 'none';
    }

    handleDragMove(e) {
        if (!this.isDragging) return;

        const touch = e.type.includes('mouse') ? e : e.touches[0];
        const currentX = touch.clientX;
        const diff = currentX - this.startX;

        this.currentTranslate = this.prevTranslate + diff;

        // Calculate velocity for momentum
        const currentTime = Date.now();
        const timeDelta = currentTime - this.lastTime;
        if (timeDelta > 0) {
            this.velocity = (currentX - this.lastX) / timeDelta * 16; // Scale for 60fps
        }
        this.lastX = currentX;
        this.lastTime = currentTime;

        // Update position smoothly
        this.track.style.transform = `translateX(${this.currentTranslate}px)`;
    }

    handleDragEnd() {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.container.style.cursor = 'grab';
        this.container.style.userSelect = '';

        // Save current position
        this.prevTranslate = this.currentTranslate;

        // Check if we need to loop
        this.checkInfiniteLoop();

        // Apply momentum scrolling
        if (Math.abs(this.velocity) > 0.5) {
            this.applyMomentum();
        }
    }

    applyMomentum() {
        const friction = 0.92;
        const minVelocity = 0.5;

        const animate = () => {
            if (Math.abs(this.velocity) > minVelocity) {
                this.currentTranslate += this.velocity;
                this.prevTranslate = this.currentTranslate;
                this.velocity *= friction;

                this.track.style.transform = `translateX(${this.currentTranslate}px)`;
                this.checkInfiniteLoop();

                this.animationID = requestAnimationFrame(animate);
            }
        };

        animate();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for buttons to fully render before initializing
    setTimeout(() => {
        const controlsContainer = document.querySelector('.meeting-controls');
        if (controlsContainer && controlsContainer.children.length > 0) {
            console.log('Initializing controls scroller with', controlsContainer.children.length, 'buttons');
            new ControlsScroller('.meeting-controls');
            // Set initial cursor
            controlsContainer.style.cursor = 'grab';
        } else {
            console.warn('Controls container not found or has no buttons');
        }
    }, 200);
});
