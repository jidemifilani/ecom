/**
 * One-off script: replace placeholder SVG image URLs with real Unsplash photos.
 *
 * Run (from project root):
 *   npx tsx --env-file .env.local prisma/update-images.ts
 *
 * Uses DATABASE_URL_UNPOOLED from .env.local for a direct (non-pooled) connection.
 */

import * as dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// Load .env.local manually so this script works without the full app env.
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('No DATABASE_URL_UNPOOLED or DATABASE_URL found in environment.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const db = new PrismaClient({ adapter });

// Curated Unsplash photo IDs per product slug.
const PHOTO_MAP: Record<string, { url: string; alt: string }> = {
  'aurora-over-ear-headphones': {
    url: 'https://images.unsplash.com/photo-1505740420857-89f8e56a9410?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Aurora Over-Ear Headphones against a light background',
  },
  'aurora-wireless-earbuds': {
    url: 'https://images.unsplash.com/photo-1572536147248-ac59a8abfa4b?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Aurora Wireless Earbuds in charging case',
  },
  'resonate-bookshelf-speaker': {
    url: 'https://images.unsplash.com/photo-1545454615-cc85fb9a9bb4?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Resonate Bookshelf Speaker on a shelf',
  },
  'resonate-portable-speaker': {
    url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Resonate Portable Speaker outdoors',
  },
  'kestrel-field-watch': {
    url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Kestrel Field Watch with clean white dial',
  },
  'kestrel-activity-band': {
    url: 'https://images.unsplash.com/photo-1575311373937-040b8058f2ab?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Kestrel Activity Band on wrist',
  },
  'lumen-arc-desk-lamp': {
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Lumen Arc Desk Lamp on a minimal desk',
  },
  'lumen-halo-pendant': {
    url: 'https://images.unsplash.com/photo-1565814329452-23b884b93f0f?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Lumen Halo Pendant glowing overhead',
  },
  'oakline-storage-crate': {
    url: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7bef?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Oakline Storage Crate in birch ply',
  },
  'oakline-entry-bench': {
    url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Oakline Entry Bench in solid oak',
  },
  'adrift-merino-tee': {
    url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Adrift Merino Tee laid flat',
  },
  'adrift-flannel-shirt': {
    url: 'https://images.unsplash.com/photo-1594938298603-c8148c4b4de5?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Adrift Flannel Shirt in brushed cotton',
  },
  'adrift-shell-jacket': {
    url: 'https://images.unsplash.com/photo-1548036161-37b8e2c5f4fd?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Adrift Shell Jacket — three-layer waterproof',
  },
  'verdant-two-person-tent': {
    url: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Verdant Two-Person Tent pitched at sunrise',
  },
  'verdant-camp-stove': {
    url: 'https://images.unsplash.com/photo-1617358258731-a8b8b292028c?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Verdant Camp Stove with blue flame',
  },
  'verdant-trail-bottle': {
    url: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Verdant Trail Bottle on a trail',
  },
  'northwind-pannier-set': {
    url: 'https://images.unsplash.com/photo-1558618048-fb5d19e6f8ef?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Northwind Pannier Set on a touring bicycle',
  },
  'oakline-standing-desk': {
    url: 'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Oakline Standing Desk in a bright home office',
  },
  'oakline-monitor-riser': {
    url: 'https://images.unsplash.com/photo-1593642634315-48f5414c3ad9?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Oakline Monitor Riser under a display',
  },
  'northwind-notebook-trio': {
    url: 'https://images.unsplash.com/photo-1544816565-aa8c1166648f?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Northwind Notebook Trio fanned open',
  },
  'kestrel-chef-knife': {
    url: 'https://images.unsplash.com/photo-1569058019-ce03a8e45a94?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Kestrel Chef Knife on a cutting board',
  },
  'lumen-pour-over-kettle': {
    url: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Lumen Pour-Over Kettle in action',
  },
  'verdant-yoga-mat': {
    url: 'https://images.unsplash.com/photo-1544367654-bef087220616?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Verdant Yoga Mat rolled out on a studio floor',
  },
  'kestrel-kettlebell-12kg': {
    url: 'https://images.unsplash.com/photo-1517344368193-41552b6ad3f5?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Kestrel Kettlebell 12 kg on gym floor',
  },
};

async function main() {
  console.log('Updating product images…\n');

  const products = await db.product.findMany({
    select: { id: true, name: true, slug: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const product of products) {
    const photo = PHOTO_MAP[product.slug];
    if (!photo) {
      console.log(`  ⚠ no mapping for slug "${product.slug}" — skipped`);
      skipped++;
      continue;
    }

    await db.$transaction([
      db.productImage.deleteMany({ where: { productId: product.id } }),
      db.productImage.create({
        data: {
          productId: product.id,
          url: photo.url,
          alt: photo.alt,
          position: 0,
          isPrimary: true,
        },
      }),
    ]);

    console.log(`  ✓ ${product.name}`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
