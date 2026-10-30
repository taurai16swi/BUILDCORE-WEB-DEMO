# BuildCore Technologies

BuildCore Technologies is a multi-section digital platform and brand website designed to position a technology company as a builder of digital infrastructure, practical support systems, and opportunity across Africa. The project combines elegant marketing presentation with a ready-to-connect backend foundation for builder onboarding, authentication, and private communication.

## Client-facing / polished overview

BuildCore exists to help people, businesses, and communities move from ideas to real-world technology outcomes. The platform communicates a clear mission: to engineer useful digital systems, enable growth, and create room for ambitious African talent to build what comes next.

The experience is designed around trust, clarity, and momentum. Visitors can understand the company’s purpose, explore services and solutions, discover featured work, and connect with the team through a structured contact flow. For builders, the platform offers a clear join pathway with profile creation and application support.

### What the platform communicates

- Digital products and technical infrastructure for real-world impact
- Business support for more resilient operations and innovation
- A people-first approach that values talent, inclusion, and collaboration
- A regional and community-centered vision rooted in Africa’s digital future

### Primary value areas

- Product design and engineering
- Technology support and troubleshooting
- Business and digital infrastructure enablement
- Community building for talent and opportunity
- Builder application and onboarding workflows

## Developer-focused / technical overview

This project is a static website backed by Supabase for authentication, builder onboarding, private messaging, content publishing, media storage, and contact enquiries. The included administrator dashboard lets authorized team members publish website updates, upload media, and manage incoming enquiries.

### Stack

- HTML5 for semantic structure
- CSS3 for visual design and responsive layouts
- Vanilla JavaScript for interactivity and form logic
- Supabase for authentication, profile data, storage, and real-time messaging
- Supabase Row Level Security for administrator-only content and enquiry management

### Runtime behavior

The web app includes:

- Section-based page routing via URL parameters
- Responsive navigation and mobile menu controls
- Builder application logic and PDF preview generation
- Optional backend hooks for auth and chat flows
- Database schema for platform roles, builder approvals, and secure message storage
- Administrator dashboard for website updates, uploads, and contact enquiries

### Project structure

```text
BUILDCORE WEB DEMO/
├── app.js                     # Page logic, navigation, form behavior, PDF generation
├── index.html                 # Main page structure and marketing content
├── styles.css                 # Global styles, layout system, responsive design
├── supabase-config.js         # Supabase connection config placeholder
├── supabase-backend.js        # Supabase auth, storage, chat functions, and dashboard logic
├── admin.html                 # Administrator sign-in and content dashboard
├── admin-dashboard.js         # Admin CMS, uploads, and enquiry management
├── admin.css                  # Responsive administrator workspace
├── site-content.js            # Public blog, event, and published-updates feed
├── footer-links.js            # Public footer links, managed in the internal admin portal
├── supabase.sql               # Database schema and platform setup for Supabase
├── buildcore-logo.png         # Primary logo asset
├── buildcore-mark.png         # Brand emblem asset
├── buildcore-horizon.svg      # Horizon-brand graphic
├── README.md                  # Project documentation
└── ...
```

## Portfolio-ready / concise summary

A modern web platform for BuildCore Technologies, designed to showcase the brand, communicate the company’s mission, and support a builder community through structured onboarding and backend-ready integrations.

This project highlights frontend design, UX flow building, and scalable architecture patterns using static HTML/CSS/JS with Supabase as the backend foundation.

## Key features

- Responsive landing page for a technology and infrastructure brand
- Multi-section storytelling experience for services, work, solutions, and opportunities
- Builder onboarding flow with profile and application capture
- Local PDF preview generation for build applications
- Supabase-ready authentication and profile infrastructure
- Secure folder and message storage design for user documents and chat attachments
- Administrator dashboard for publishing stories, managing media, and triaging enquiries
- Public website feed that automatically displays published updates
- Clear separation between front-end experience and backend integration logic

## How to run locally

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd "BUILDCORE WEB DEMO"
```

### 2. Start a local server

Because this is a static site, you can open `index.html` directly or serve it locally.

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Supabase setup

The project includes Supabase support but does not connect automatically until credentials are added.

### 1. Create a Supabase project

- Log in to Supabase
- Create a new project
- Copy the project URL and anon key

### 2. Configure the app

Update `supabase-config.js` as follows:

```javascript
window.BUILDCORE_SUPABASE_CONFIG = {
  url: "YOUR_SUPABASE_PROJECT_URL",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

### 3. Apply the database SQL

Open the Supabase SQL editor and run the complete contents of `supabase.sql`. The script creates or updates the public content, media, and enquiry tables, storage policies, and row-level security rules alongside the existing builder and messaging schema. Re-run it after pulling schema changes so the account-profile functions and builder self-edit permissions are installed.

This script creates:

- `profiles` table for platform users
- `builder_profiles` table for builder onboarding and approval logic
- `chatter_box_messages` for private communication
- role and access helpers
- builder tag generation logic
- `site_updates` for blog stories, tech magazine and newsletter features, event announcements and recaps, and drafts
- `footer_links` for public website footer links, editable only by administrators
- `media_assets` and a public `site-media` bucket for website images and videos
- `contact_submissions` for messages collected through the contact form
- admin-only content, inbox, and footer-link permissions, plus public read-only feeds for stories and enabled footer links

### 4. Create the first administrator

1. Start the website using the local server instructions and create a regular user account through the existing sign-up flow.
2. In Supabase **Authentication → Users**, copy that account's user ID.
3. In the SQL Editor, promote that trusted account. Replace the placeholder with its UUID:

   ```sql
   update public.profiles
   set role = 'admin', updated_at = now()
   where id = '<trusted-auth-user-uuid>';
   ```

4. Open `http://localhost:8000/admin.html` and sign in with that account.

Never expose or use a Supabase `service_role` key in the website. Admin actions use the public anon key plus database-enforced administrator role checks and RLS.

### 5. Using the dashboard

- **Updates & stories:** create, edit, publish, save drafts, or delete content. Published stories appear automatically in the Blog & events section.
- **Footer links:** update the labels, addresses, and visibility of the proposed public footer links from the internal admin portal. Blank addresses display as plain text until a destination is configured.
- **Media library:** upload and copy links for images and videos. Supported types are JPEG, PNG, WebP, GIF, MP4, and WebM, with a 25 MB file limit.
- **Enquiries:** review website contact submissions and set their status to new, in progress, or resolved.
- Database triggers maintain update timestamps and publication dates. Contact submissions and uploaded media are stored in Supabase, not only in the browser.

### 6. Account and builder profiles

- Individuals can create an account with email or a configured identity provider. After authentication, sign-up and sign-in controls are replaced with **My account** and **Sign out**.
- Builders create a builder account, submit the application and private identity documents, then wait for an administrator to approve the application in the admin dashboard.
- Approved builders can use **My account** to update their name, professional details, skills, experience, portfolio link, and private certificates. Their identity document and approval status are not editable from their profile.
- Profile changes are enforced by Supabase functions, table permissions, and row-level security. Re-run `supabase.sql` before using this settings flow on an existing Supabase project.

## Important notes for production

- Keep all service-role credentials out of browser code
- Use Row Level Security and authenticated roles in production
- Validate uploaded files and enforce proper file-size and MIME checks
- Configure Supabase Auth email confirmation, SMTP, backups, and appropriate storage/CDN policies before launch
- The public media bucket is intended for public website assets only; never upload identity documents or other private files to it
- Contact submissions are saved to the database; outbound email notifications require a separately configured email provider or Supabase Edge Function
- Review all environment values before deploying live
- Treat the current setup as a strong foundation for a production-ready build, not as a complete production deployment by default

## Customization and extension

You can tailor the brand and system behavior in these files:

- `index.html` – brand copy, layout structure, section content
- `styles.css` – visual design, spacing, colors, responsiveness
- `app.js` – front-end behavior and navigation logic
- `supabase-config.js` – environment integration
- `supabase-backend.js` – authentication, storage, and chat behavior
- `admin.html`, `admin-dashboard.js`, and `admin.css` – administrator publishing and management workspace
- `site-content.js` – published website updates
- `supabase.sql` – database schema and permissions

## Why this project is strong

This project demonstrates several meaningful product and engineering capabilities:

- Brand-centered web design and storytelling
- Responsive UI development
- Business workflow thinking through onboarding and communication
- Structured implementation of authentication and secure data handling
- Practical database design with role-based access patterns
- Ready-to-scale architecture for a growing digital platform

## License

This project is currently configured for internal or project-specific usage. If it will be republished, commercialized, or distributed externally, confirm licensing and legal usage requirements before deployment.

## Contact

For project discussions, collaboration, support, or product expansion, use the contact flow embedded in the website or connect through your organization’s designated communication channel.

## Quick project summary

BuildCore is a polished digital platform and builder ecosystem website built with HTML, CSS, JavaScript, and Supabase. It showcases a modern African technology brand, supports onboarding flows for builders, and provides a secure, extensible backend foundation for future growth.
