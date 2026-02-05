# Copilot Instructions for Hanna Dunchenko Paralegal Services Website

## Project Overview
Single-page HTML5 website for paralegal services in the GTA (Toronto area). Built entirely in vanilla JavaScript with modern CSS (glassmorphism, animations, responsive design). No build process, no framework dependencies—pure HTML/CSS/JS.

## Architecture & Code Organization

### Single-File Structure
- **index.html**: Complete application (HTML, inline CSS, inline JavaScript)
  - Header with phone CTA
  - Contact form with validation
  - FAQ accordion section
  - SEO content section
  - Footer with hours/contact

### Key Design Patterns

**CSS Variables (`:root`)**
- Color theme controlled via custom properties: `--bg-dark`, `--text-white`, `--glass-bg`, etc.
- Used throughout for consistent theming and easy customization
- Located at top of `<style>` block

**Animations**
- `revealAnimation`: 3s entrance animation (blur → sharp, fade in) on header/form
- `glow`: 4s pulsing animation on form inputs (default state)
- `flashBorder`: 0.6s border highlight for validation feedback
- All defined in `@keyframes` section before component styles

**Form Validation**
- Client-side only: checks for empty fields + consent checkbox
- Flash animation triggers on invalid submit
- Required fields: name, message (textarea), contact, consent checkbox
- Disabled: actual form submission (preventDefault), no backend integration

## Development Patterns

### Form Input Behavior
```javascript
// Focus behavior blurs non-focused inputs
formInputs.forEach(input => {
    input.addEventListener('focus', () => {
        formInputs.forEach(other => {
            if (other !== input) other.classList.add('blur-non-focus');
        });
    });
});

// "has-content" class toggles styling when input has text
input.addEventListener('input', () => {
    if (input.value.trim()) input.classList.add('has-content');
});
```

### FAQ Accordion Pattern
- `.faq-item` wraps question (`.faq-q`) and answer (`.faq-a`)
- Toggle active state on click: `item.classList.toggle('active')`
- All FAQs open by default on load
- Prevents accordion collapse on IFRAME/link clicks

### Textarea Auto-Resize
- `briefArea.addEventListener('input', function() { this.style.height = this.scrollHeight + 'px'; })`
- Character counter syncs: `counterDisplay.textContent = this.value.length`

### Loader/Preloader Management
- `.loader` element with spinner fades out on page load
- Uses transition end event to set `hidden` class (removes from layout)
- Fallback timeout ensures hidden after 700ms

### Stripe Background Animation
- Optimized with `requestAnimationFrame` and math transforms
- Uses `requestIdleCallback` to defer until browser is idle
- Each stripe has independent seed/speed for organic motion

## File Attachment Icon
- `.attach-icon` SVG opens native file input dialog
- No file upload functionality—only visual feedback (color pulse)
- Silently logs file name to console

## CSS Responsive Strategy

**Mobile-First Breakpoints**
- Base: `clamp()` functions scale all typography
- `@media (max-width: 720px)`: Primary mobile adjustments
- `@media (max-width: 480px)`: Extra small devices
- **iPhone-specific**: Device-width media queries for precise targeting (375px, 390px, 414px, 430px)

**Key Pattern**: Use `clamp(min, preferred, max)` instead of fixed sizes
```css
.name-title { font-size: clamp(2.5rem, 6vw, 4.5rem); }
```

## Styling Conventions

**Glass Effect** (`.glass-form`)
- `backdrop-filter: blur(20px)` + `-webkit-backdrop-filter`
- `border: 1px solid var(--glass-border)`
- Pseudo-elements (::before, ::after) for gradient borders/glow

**Input States**
- Default: glowing animation, transparent bg, white text
- Focus/has-content: white bg, brown text, no glow animation
- Non-focus blur: opacity 0.6

**Accessibility Notes**
- `::-webkit-user-select: none` on phone links (prevent accidental selection)
- `scroll-padding-top: 80px` for sticky header offset
- Placeholder text aligned left in inputs, center in form title

## Integration Points

**External Resources**
- Google Fonts (Lato): `https://fonts.googleapis.com/css2?family=Lato`
- Google Maps Embed: iframe in "Where is your office?" FAQ
- Form data: Not sent anywhere (validate only, no backend)

**Phone/Contact**
- Phone link: `href="tel:+14372396833"`
- Email references in privacy FAQ but no contact form integration

## Common Modification Scenarios

### Adding a New FAQ Item
```html
<div class="faq-item">
    <div class="faq-q">Question text?</div>
    <div class="faq-a">Answer content here...</div>
</div>
<!-- JavaScript auto-toggles via .active class -->
```

### Updating Colors
Edit `:root` variables only:
```css
:root {
    --bg-dark: #bfa792;  /* Main background */
    --accent-gold: #6B5B4A;  /* Text/accents */
    --text-white: #ffffff;
}
```

### Adding Form Fields
1. Add input/textarea in form
2. Add to `formInputs` array in JavaScript if validation needed
3. Add corresponding name attribute for form data

### Adjusting Animations
- All `@keyframes` defined in CSS (find by animation name)
- Duration/timing controlled via `animation: name Xs ease`
- JavaScript adds/removes classes to trigger animations

## Testing & Validation

**Manual Testing Checklist**
- Form validation: submit with empty fields → should flash
- Mobile responsiveness: check at 320px, 480px, 720px widths
- FAQ toggle: click questions, verify expand/collapse
- Animations: check loader fade, input glow, stripe movement
- Phone link: tap on mobile to verify call integration

**Browser Compatibility Notes**
- `-webkit-` prefixes included for Safari (backdrop-filter, user-select)
- `clamp()` function requires modern browsers (mobile-first design)
- `requestIdleCallback` has fallback timeout

## Special Considerations

- **No Build Process**: Edit directly in HTML; no compilation step
- **No State Management**: All logic is imperative DOM manipulation
- **Offline-Ready**: No external API calls (except Maps embed)
- **Analytics Ready**: Form has hooks for advertising pixel data (Facebook, Google, YouTube mentioned in privacy policy)
- **Accessibility**: WCAG basics covered (semantic HTML, color contrast in glass form good due to high opacity)
