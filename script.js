// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    });
});

// Initialize gallery lightbox
const galleryItems = document.querySelectorAll('.project');
galleryItems.forEach(item => {
    item.addEventListener('click', () => {
        const imgSrc = item.style.backgroundImage
            .replace('url("', '')
            .replace('")', '');
        openLightbox(imgSrc);
    });
});

function openLightbox(src) {
    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML = `
        <div class="lightbox-content">
            <img src="${src}" alt="Gallery Image">
            <span class="close">&times;</span>
        </div>
    `;
    document.body.appendChild(lightbox);
    
    lightbox.querySelector('.close').addEventListener('click', () => {
        lightbox.remove();
    });
}


// Form submission handling
document.querySelector('.wpcf7-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    // Get form data
    const formData = new FormData(this);
    
    // Simulate form submission
    setTimeout(() => {
        this.reset();
        showSuccessMessage('Thank you for your message! We will get back to you soon.');
    }, 1000);
});

function showSuccessMessage(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'form-success';
    successDiv.textContent = message;
    
    const form = document.querySelector('.wpcf7-form');
    form.parentNode.insertBefore(successDiv, form.nextSibling);
    
    setTimeout(() => {
        successDiv.remove();
    }, 5000);
}
