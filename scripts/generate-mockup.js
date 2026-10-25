import fs from 'node:fs';
import sharp from 'sharp';

const svg = `
<svg width="1600" height="1300" viewBox="0 0 1600 1300" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, -apple-system, sans-serif">
  <defs>
    <linearGradient id="heroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#d97706"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1600" height="1300" fill="#f8fafc"/>

  <!-- Top Header Title -->
  <rect x="0" y="0" width="1600" height="70" fill="#1e293b"/>
  <text x="40" y="45" font-size="24" font-weight="bold" fill="#ffffff">Maya's Bakes - Website Design Mockup (Desktop &amp; Mobile Responsive Breakpoints)</text>

  <!-- ==================== DESKTOP VIEW (LEFT) ==================== -->
  <text x="50" y="105" font-size="18" font-weight="bold" fill="#334155">DESKTOP MOCKUP (1200px Viewport)</text>
  <rect x="50" y="120" width="1050" height="1130" rx="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>

  <!-- Desktop Browser Bar -->
  <rect x="50" y="120" width="1050" height="35" rx="8" fill="#e2e8f0"/>
  <circle cx="75" cy="137" r="6" fill="#ef4444"/>
  <circle cx="95" cy="137" r="6" fill="#f59e0b"/>
  <circle cx="115" cy="137" r="6" fill="#10b981"/>
  <rect x="145" y="127" width="500" height="20" rx="4" fill="#ffffff"/>
  <text x="160" y="141" font-size="11" fill="#64748b">https://mayasbakes.com (Desktop Preview)</text>

  <!-- Desktop Nav Header & Logo -->
  <rect x="50" y="155" width="1050" height="55" fill="#fffbeb" stroke="#fef3c7"/>
  <rect x="80" y="167" width="160" height="32" rx="6" fill="#d97706"/>
  <text x="95" y="188" font-size="14" font-weight="bold" fill="#ffffff">[BAKERY LOGO]</text>
  <text x="255" y="188" font-size="16" font-weight="bold" fill="#78350f">Maya's Bakes</text>
  <text x="800" y="188" font-size="13" font-weight="500" fill="#92400e">Home &#160;&#160;&#160; Menu &#160;&#160;&#160; Gallery &#160;&#160;&#160; Contact</text>

  <!-- 1. HERO SECTION -->
  <rect x="80" y="225" width="990" height="170" rx="8" fill="url(#heroGrad)"/>
  <rect x="110" y="245" width="130" height="28" rx="4" fill="rgba(255,255,255,0.2)"/>
  <text x="120" y="264" font-size="12" font-weight="bold" fill="#ffffff">HERO SECTION</text>
  <text x="110" y="305" font-size="28" font-weight="bold" fill="#ffffff">Fresh Artisan Breads &amp; Pastries Daily</text>
  <text x="110" y="335" font-size="14" fill="#fef3c7">Handcrafted with organic local flour, slow-fermented for exceptional flavor.</text>
  <rect x="110" y="350" width="130" height="32" rx="6" fill="#ffffff"/>
  <text x="135" y="371" font-size="13" font-weight="bold" fill="#b45309">Explore Menu</text>

  <!-- 2. MENU SECTION (8 ITEMS WITH PRICES) -->
  <text x="80" y="425" font-size="18" font-weight="bold" fill="#1e293b">Bakery Menu (8 Items with Prices)</text>
  <line x1="80" y1="435" x2="1070" y2="435" stroke="#e2e8f0" stroke-width="1"/>

  <!-- Menu Row 1 -->
  <rect x="80" y="450" width="230" height="55" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="95" y="473" font-size="13" font-weight="bold" fill="#334155">1. Sourdough Loaf</text>
  <text x="95" y="493" font-size="13" font-weight="bold" fill="#d97706">$6.50</text>

  <rect x="330" y="450" width="230" height="55" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="345" y="473" font-size="13" font-weight="bold" fill="#334155">2. Butter Croissant</text>
  <text x="345" y="493" font-size="13" font-weight="bold" fill="#d97706">$3.75</text>

  <rect x="580" y="450" width="230" height="55" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="595" y="473" font-size="13" font-weight="bold" fill="#334155">3. Blueberry Muffin</text>
  <text x="595" y="493" font-size="13" font-weight="bold" fill="#d97706">$4.00</text>

  <rect x="830" y="450" width="240" height="55" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="845" y="473" font-size="13" font-weight="bold" fill="#334155">4. Chocolate Éclair</text>
  <text x="845" y="493" font-size="13" font-weight="bold" fill="#d97706">$4.50</text>

  <!-- Menu Row 2 -->
  <rect x="80" y="515" width="230" height="55" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="95" y="538" font-size="13" font-weight="bold" fill="#334155">5. French Baguette</text>
  <text x="95" y="558" font-size="13" font-weight="bold" fill="#d97706">$3.50</text>

  <rect x="330" y="515" width="230" height="55" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="345" y="538" font-size="13" font-weight="bold" fill="#334155">6. Cinnamon Roll</text>
  <text x="345" y="558" font-size="13" font-weight="bold" fill="#d97706">$4.25</text>

  <rect x="580" y="515" width="230" height="55" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="595" y="538" font-size="13" font-weight="bold" fill="#334155">7. Almond Danish</text>
  <text x="595" y="558" font-size="13" font-weight="bold" fill="#d97706">$4.50</text>

  <rect x="830" y="515" width="240" height="55" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="845" y="538" font-size="13" font-weight="bold" fill="#334155">8. Strawberry Tart</text>
  <text x="845" y="558" font-size="13" font-weight="bold" fill="#d97706">$5.00</text>

  <!-- 3. PHOTO GALLERY SECTION (6 IMAGE PLACEHOLDERS) -->
  <text x="80" y="605" font-size="18" font-weight="bold" fill="#1e293b">Photo Gallery Layout (6 Image Placeholders)</text>
  <line x1="80" y1="615" x2="1070" y2="615" stroke="#e2e8f0" stroke-width="1"/>

  <rect x="80" y="630" width="150" height="110" rx="6" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="4"/>
  <text x="95" y="680" font-size="12" font-weight="bold" fill="#64748b">[Image 1]</text>
  <text x="95" y="700" font-size="10" fill="#94a3b8">Sourdough Loaves</text>

  <rect x="245" y="630" width="150" height="110" rx="6" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="4"/>
  <text x="260" y="680" font-size="12" font-weight="bold" fill="#64748b">[Image 2]</text>
  <text x="260" y="700" font-size="10" fill="#94a3b8">Flaky Croissants</text>

  <rect x="410" y="630" width="150" height="110" rx="6" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="4"/>
  <text x="425" y="680" font-size="12" font-weight="bold" fill="#64748b">[Image 3]</text>
  <text x="425" y="700" font-size="10" fill="#94a3b8">Stone Hearth Oven</text>

  <rect x="575" y="630" width="150" height="110" rx="6" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="4"/>
  <text x="590" y="680" font-size="12" font-weight="bold" fill="#64748b">[Image 4]</text>
  <text x="590" y="700" font-size="10" fill="#94a3b8">Baker Kneading</text>

  <rect x="740" y="630" width="150" height="110" rx="6" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="4"/>
  <text x="755" y="680" font-size="12" font-weight="bold" fill="#64748b">[Image 5]</text>
  <text x="755" y="700" font-size="10" fill="#94a3b8">Morning Display</text>

  <rect x="905" y="630" width="165" height="110" rx="6" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="4"/>
  <text x="920" y="680" font-size="12" font-weight="bold" fill="#64748b">[Image 6]</text>
  <text x="920" y="700" font-size="10" fill="#94a3b8">Artisan Tart Prep</text>

  <!-- 4. CONTACT FORM SECTION -->
  <text x="80" y="775" font-size="18" font-weight="bold" fill="#1e293b">Contact Us Section (Name, Email, Message Form)</text>
  <line x1="80" y1="785" x2="1070" y2="785" stroke="#e2e8f0" stroke-width="1"/>

  <rect x="80" y="800" width="990" height="380" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>
  
  <text x="110" y="835" font-size="13" font-weight="bold" fill="#475569">Name:</text>
  <rect x="110" y="845" width="400" height="35" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="125" y="868" font-size="12" fill="#94a3b8">[Enter your full name]</text>

  <text x="540" y="835" font-size="13" font-weight="bold" fill="#475569">Email:</text>
  <rect x="540" y="845" width="400" height="35" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="555" y="868" font-size="12" fill="#94a3b8">[Enter your email address]</text>

  <text x="110" y="915" font-size="13" font-weight="bold" fill="#475569">Message:</text>
  <rect x="110" y="925" width="830" height="80" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
  <text x="125" y="955" font-size="12" fill="#94a3b8">[Type your inquiry, catering request, or feedback...]</text>

  <rect x="110" y="1025" width="180" height="38" rx="6" fill="#d97706"/>
  <text x="145" y="1049" font-size="14" font-weight="bold" fill="#ffffff">Send Message</text>


  <!-- ==================== MOBILE VIEW (RIGHT) ==================== -->
  <text x="1140" y="105" font-size="18" font-weight="bold" fill="#334155">MOBILE VIEW (375px Breakpoint)</text>
  <rect x="1140" y="120" width="410" height="1130" rx="24" fill="#ffffff" stroke="#334155" stroke-width="4"/>

  <!-- Phone Notch -->
  <rect x="1280" y="128" width="130" height="16" rx="8" fill="#334155"/>

  <!-- Mobile Browser Header -->
  <rect x="1144" y="150" width="402" height="45" fill="#fffbeb" stroke="#fef3c7"/>
  <rect x="1160" y="158" width="110" height="28" rx="4" fill="#d97706"/>
  <text x="1170" y="177" font-size="11" font-weight="bold" fill="#ffffff">[BAKERY LOGO]</text>
  <text x="1480" y="178" font-size="18" fill="#92400e">☰</text>

  <!-- Mobile Hero -->
  <rect x="1155" y="205" width="380" height="140" rx="8" fill="url(#heroGrad)"/>
  <text x="1170" y="235" font-size="18" font-weight="bold" fill="#ffffff">Maya's Bakes</text>
  <text x="1170" y="260" font-size="12" fill="#fef3c7">Fresh artisan breads and pastries daily.</text>
  <rect x="1170" y="285" width="100" height="26" rx="4" fill="#ffffff"/>
  <text x="1185" y="302" font-size="11" font-weight="bold" fill="#b45309">Our Menu</text>

  <!-- Mobile Menu (8 items) -->
  <text x="1155" y="370" font-size="14" font-weight="bold" fill="#1e293b">Menu (8 Items)</text>
  <text x="1155" y="395" font-size="11" fill="#334155">1. Sourdough Loaf - $6.50</text>
  <text x="1155" y="415" font-size="11" fill="#334155">2. Butter Croissant - $3.75</text>
  <text x="1155" y="435" font-size="11" fill="#334155">3. Blueberry Muffin - $4.00</text>
  <text x="1155" y="455" font-size="11" fill="#334155">4. Chocolate Éclair - $4.50</text>
  <text x="1155" y="475" font-size="11" fill="#334155">5. French Baguette - $3.50</text>
  <text x="1155" y="495" font-size="11" fill="#334155">6. Cinnamon Roll - $4.25</text>
  <text x="1155" y="515" font-size="11" fill="#334155">7. Almond Danish - $4.50</text>
  <text x="1155" y="535" font-size="11" fill="#334155">8. Strawberry Tart - $5.00</text>

  <!-- Mobile Gallery (6 items) -->
  <text x="1155" y="575" font-size="14" font-weight="bold" fill="#1e293b">Photo Gallery (6 images)</text>
  <rect x="1155" y="590" width="115" height="65" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="2"/>
  <text x="1175" y="627" font-size="10" fill="#64748b">[Photo 1]</text>

  <rect x="1280" y="590" width="115" height="65" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="2"/>
  <text x="1300" y="627" font-size="10" fill="#64748b">[Photo 2]</text>

  <rect x="1405" y="590" width="115" height="65" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="2"/>
  <text x="1425" y="627" font-size="10" fill="#64748b">[Photo 3]</text>

  <rect x="1155" y="665" width="115" height="65" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="2"/>
  <text x="1175" y="702" font-size="10" fill="#64748b">[Photo 4]</text>

  <rect x="1280" y="665" width="115" height="65" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="2"/>
  <text x="1300" y="702" font-size="10" fill="#64748b">[Photo 5]</text>

  <rect x="1405" y="665" width="115" height="65" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="2"/>
  <text x="1425" y="702" font-size="10" fill="#64748b">[Photo 6]</text>

  <!-- Mobile Contact Form -->
  <text x="1155" y="760" font-size="14" font-weight="bold" fill="#1e293b">Contact Form</text>
  <text x="1155" y="780" font-size="10" fill="#64748b">Name: [Text Field]</text>
  <rect x="1155" y="785" width="365" height="24" rx="4" fill="#ffffff" stroke="#cbd5e1"/>

  <text x="1155" y="825" font-size="10" fill="#64748b">Email: [Email Field]</text>
  <rect x="1155" y="830" width="365" height="24" rx="4" fill="#ffffff" stroke="#cbd5e1"/>

  <text x="1155" y="870" font-size="10" fill="#64748b">Message: [Message Field]</text>
  <rect x="1155" y="875" width="365" height="45" rx="4" fill="#ffffff" stroke="#cbd5e1"/>

  <rect x="1155" y="935" width="130" height="28" rx="4" fill="#d97706"/>
  <text x="1175" y="953" font-size="11" font-weight="bold" fill="#ffffff">Submit Message</text>
</svg>
`;

async function run() {
  await sharp(Buffer.from(svg))
    .png()
    .toFile('public/mayas_bakes_mockup_evidence.png');
  console.log('Successfully created public/mayas_bakes_mockup_evidence.png');
}

run();
