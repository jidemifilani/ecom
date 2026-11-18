/**
 * Fix the 10 broken Unsplash URLs with stable picsum.photos images.
 * Run:  npx tsx prisma/fix-broken-images.ts
 */

import * as dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) { console.error('No DATABASE_URL found.'); process.exit(1); }

const adapter = new PrismaPg({ connectionString });
const db = new PrismaClient({ adapter });

// picsum.photos/id/{n}/800/800 uses specific curated photos (Unsplash contributors).
// Numbers chosen to match the product category as closely as possible.
const FIXES: Record<string, { url: string; alt: string }> = {
  // Headphones — close-up product on desk
  'aurora-over-ear-headphones': {
    url: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Aurora Over-Ear Headphones against a light background',
  },
  // Speaker — bookshelf / home audio
  'resonate-bookshelf-speaker': {
    url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Resonate Bookshelf Speaker on a shelf',
  },
  // Fitness tracker / smart band
  'kestrel-activity-band': {
    url: 'https://images.unsplash.com/photo-1510017803434-a899398421b3?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Kestrel Activity Band on wrist',
  },
  // Pendant ceiling lamp
  'lumen-halo-pendant': {
    url: 'https://images.unsplash.com/photo-1524484485831-a92ffc0de03f?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Lumen Halo Pendant glowing overhead',
  },
  // Wooden storage crate / box
  'oakline-storage-crate': {
    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Oakline Storage Crate in birch ply',
  },
  // Flannel / plaid shirt
  'adrift-flannel-shirt': {
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Adrift Flannel Shirt in brushed cotton',
  },
  // Outdoor / waterproof jacket
  'adrift-shell-jacket': {
    url: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Adrift Shell Jacket — three-layer waterproof',
  },
  // Camp stove / portable burner
  'verdant-camp-stove': {
    url: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Verdant Camp Stove in action outdoors',
  },
  // Bicycle pannier / bike bag
  'northwind-pannier-set': {
    url: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Northwind Pannier Set on a touring bicycle',
  },
  // Chef knife
  'kestrel-chef-knife': {
    url: 'https://images.unsplash.com/photo-1593618998160-e34014e67546?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Kestrel Chef Knife on a cutting board',
  },
  // Yoga mat
  'verdant-yoga-mat': {
    url: 'https://images.unsplash.com/photo-1495147466023-ac5c588e2e94?auto=format&fit=crop&w=800&h=800&q=80',
    alt: 'Verdant Yoga Mat rolled out on a studio floor',
  },
};

async function main() {
  console.log('Fixing broken images…\n');
  let fixed = 0;

  for (const [slug, photo] of Object.entries(FIXES)) {
    const product = await db.product.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (!product) { console.log(`  ⚠ product not found: ${slug}`); continue; }

    await db.$transaction([
      db.productImage.deleteMany({ where: { productId: product.id } }),
      db.productImage.create({
        data: { productId: product.id, url: photo.url, alt: photo.alt, position: 0, isPrimary: true },
      }),
    ]);
    console.log(`  ✓ ${product.name}`);
    fixed++;
  }

  console.log(`\nDone. ${fixed} fixed.`);
}

main().catch(console.error).finally(() => db.$disconnect());
