import 'dotenv/config';

import { hashPassword } from '@/lib/auth/password';
import { db } from '@/lib/db';
import { SETTINGS } from '@/lib/settings-registry';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  ROLE_PRESETS,
  SUPER_ADMIN_ROLE_KEY,
  resolvePresetPermissions,
  splitPermission,
} from '@/lib/rbac/permissions';
import { slugify } from '@/lib/utils';
import {
  CustomerStatus,
  FulfillmentStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
  ReviewStatus,
  ShipmentStatus,
  StockMovementType,
  UserStatus,
} from '@/generated/prisma/enums';

/**
 * Database seed.
 *
 * Idempotent by design: every record is matched on a natural key (permission
 * key, role key, slug, SKU, email) and upserted. Demo data tops up to a target
 * count rather than appending, so running the seed twice does not double the
 * catalogue. Running it against a configured installation will not overwrite
 * settings an administrator has already changed.
 *
 *   npm run db:seed
 */

const log = (message: string): void => {
  process.stdout.write(`  ${message}\n`);
};

// ── Reference data (always seeded) ───────────────────────────────────────────

const seedPermissions = async (): Promise<void> => {
  for (const key of ALL_PERMISSION_KEYS) {
    const { resource, action } = splitPermission(key);
    const definition = PERMISSIONS[key];

    await db.permission.upsert({
      where: { key },
      create: {
        key,
        resource,
        action,
        group: definition.group,
        description: definition.description,
      },
      // Labels may be reworded between releases; the key never changes.
      update: { group: definition.group, description: definition.description },
    });
  }
  log(`permissions: ${ALL_PERMISSION_KEYS.length} in catalogue`);
};

const seedRoles = async (): Promise<void> => {
  const permissionIdByKey = new Map(
    (await db.permission.findMany({ select: { id: true, key: true } })).map((row) => [
      row.key,
      row.id,
    ]),
  );

  for (const preset of ROLE_PRESETS) {
    const role = await db.role.upsert({
      where: { key: preset.key },
      create: {
        key: preset.key,
        name: preset.name,
        description: preset.description,
        level: preset.level,
        isSystem: preset.isSystem,
      },
      update: {
        name: preset.name,
        description: preset.description,
        level: preset.level,
        isSystem: preset.isSystem,
        deletedAt: null,
      },
      select: { id: true },
    });

    const wanted = resolvePresetPermissions(preset)
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => typeof id === 'string');

    const current = await db.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    });
    const currentIds = new Set(current.map((row) => row.permissionId));
    const wantedIds = new Set(wanted);

    const toAdd = wanted.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !wantedIds.has(id));

    if (toAdd.length > 0) {
      await db.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length > 0) {
      await db.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove } },
      });
    }

    log(`role ${preset.key}: ${wanted.length} permissions (+${toAdd.length} -${toRemove.length})`);
  }
};

const seedSettings = async (): Promise<void> => {
  let created = 0;

  for (const definition of SETTINGS) {
    const existing = await db.setting.findUnique({
      where: { key: definition.key },
      select: { id: true },
    });

    if (existing) {
      // Refresh only the descriptive metadata. The configured VALUE is left
      // alone: re-seeding must never silently reset a live configuration.
      await db.setting.update({
        where: { key: definition.key },
        data: {
          group: definition.group,
          label: definition.label,
          description: definition.description,
          type: definition.type,
          isSecret: definition.isSecret ?? false,
        },
      });
      continue;
    }

    await db.setting.create({
      data: {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        type: definition.type,
        value: definition.defaultValue,
        isSecret: definition.isSecret ?? false,
      },
    });
    created += 1;
  }

  log(`settings: ${SETTINGS.length} declared, ${created} newly created`);
};

const seedSuperAdmin = async (): Promise<string> => {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? '';

  if (!email || !password) {
    throw new Error(
      'SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD must be set before seeding. ' +
        'Generate a password with: node -e "console.log(require(\'crypto\').randomBytes(12).toString(\'base64url\'))"',
    );
  }
  if (password.length < 12) {
    throw new Error('SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters.');
  }

  const role = await db.role.findUniqueOrThrow({
    where: { key: SUPER_ADMIN_ROLE_KEY },
    select: { id: true },
  });

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });

  if (existing) {
    // Never rewrite the password of an account that already exists: that would
    // let anyone with shell access reset the owner's credentials by re-seeding.
    await db.userRole.upsert({
      where: { userId_roleId: { userId: existing.id, roleId: role.id } },
      create: { userId: existing.id, roleId: role.id },
      update: {},
    });
    log(`super admin: ${email} already exists (password left unchanged)`);
    return existing.id;
  }

  const user = await db.user.create({
    data: {
      email,
      firstName: 'Platform',
      lastName: 'Owner',
      status: UserStatus.ACTIVE,
      passwordHash: await hashPassword(password),
      passwordSetAt: new Date(),
      emailVerifiedAt: new Date(),
      mustChangePassword: true,
      roles: { create: { roleId: role.id } },
    },
    select: { id: true },
  });

  log(`super admin: created ${email} (must change password on first sign-in)`);
  return user.id;
};

// ── Demo data ────────────────────────────────────────────────────────────────

/** Deterministic pseudo-random so repeated seeds produce the same catalogue. */
const makeRandom = (seed: number) => {
  let state = seed;
  return (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const DEMO_CATEGORIES: { name: string; image: string; children: string[] }[] = [
  { name: 'Audio', image: 'audio', children: ['Headphones', 'Speakers'] },
  { name: 'Wearables', image: 'wearables', children: ['Smartwatches', 'Trackers'] },
  { name: 'Home & Living', image: 'home', children: ['Lighting', 'Storage'] },
  { name: 'Apparel', image: 'apparel', children: ['Tops', 'Outerwear'] },
  { name: 'Outdoors', image: 'outdoors', children: ['Camping', 'Cycling'] },
  { name: 'Office', image: 'office', children: ['Desk', 'Stationery'] },
  { name: 'Kitchen', image: 'kitchen', children: [] },
  { name: 'Fitness', image: 'fitness', children: [] },
];

const DEMO_BRANDS = ['Northwind', 'Lumen', 'Adrift', 'Kestrel', 'Verdant', 'Oakline'];

type DemoProduct = {
  name: string;
  category: string;
  brand: string;
  image: string;
  price: number;
  compareAt?: number;
  cost: number;
  short: string;
  options?: { name: string; values: string[] };
};

const DEMO_PRODUCTS: DemoProduct[] = [
  { name: 'Aurora Over-Ear Headphones', category: 'Headphones', brand: 'Lumen', image: 'audio', price: 24900, compareAt: 29900, cost: 11200, short: 'Closed-back headphones with 40-hour battery and adaptive noise cancelling.', options: { name: 'Colour', values: ['Midnight', 'Sand', 'Slate'] } },
  { name: 'Aurora Wireless Earbuds', category: 'Headphones', brand: 'Lumen', image: 'audio', price: 12900, cost: 5400, short: 'Compact earbuds with a pocketable charging case.' },
  { name: 'Resonate Bookshelf Speaker', category: 'Speakers', brand: 'Northwind', image: 'audio', price: 38900, cost: 19500, short: 'Two-way bookshelf speaker with a woven mid driver.' },
  { name: 'Resonate Portable Speaker', category: 'Speakers', brand: 'Northwind', image: 'audio', price: 8900, compareAt: 10900, cost: 3600, short: 'Splash-resistant speaker that packs into a jacket pocket.', options: { name: 'Colour', values: ['Black', 'Clay'] } },
  { name: 'Kestrel Field Watch', category: 'Smartwatches', brand: 'Kestrel', image: 'wearables', price: 44900, cost: 21000, short: 'Sapphire-crystal smartwatch with a 14-day battery.', options: { name: 'Band', values: ['Nylon', 'Leather', 'Steel'] } },
  { name: 'Kestrel Activity Band', category: 'Trackers', brand: 'Kestrel', image: 'wearables', price: 7900, cost: 2800, short: 'Lightweight tracker with sleep and recovery scoring.', options: { name: 'Size', values: ['Small', 'Large'] } },
  { name: 'Lumen Arc Desk Lamp', category: 'Lighting', brand: 'Lumen', image: 'home', price: 15900, cost: 6700, short: 'Dimmable LED lamp with a weighted brass base.' },
  { name: 'Lumen Halo Pendant', category: 'Lighting', brand: 'Lumen', image: 'home', price: 22900, cost: 9800, short: 'Opal glass pendant that spreads light without glare.' },
  { name: 'Oakline Storage Crate', category: 'Storage', brand: 'Oakline', image: 'home', price: 5900, cost: 2100, short: 'Stackable birch-ply crate with cut-out handles.', options: { name: 'Size', values: ['Medium', 'Large'] } },
  { name: 'Oakline Entry Bench', category: 'Storage', brand: 'Oakline', image: 'home', price: 31900, compareAt: 36900, cost: 15400, short: 'Solid-oak bench with a slatted shoe shelf.' },
  { name: 'Adrift Merino Tee', category: 'Tops', brand: 'Adrift', image: 'apparel', price: 6900, cost: 2600, short: 'Fine-gauge merino tee that resists odour on long trips.', options: { name: 'Size', values: ['S', 'M', 'L', 'XL'] } },
  { name: 'Adrift Flannel Shirt', category: 'Tops', brand: 'Adrift', image: 'apparel', price: 9900, cost: 3900, short: 'Brushed cotton flannel with a relaxed cut.', options: { name: 'Size', values: ['S', 'M', 'L', 'XL'] } },
  { name: 'Adrift Shell Jacket', category: 'Outerwear', brand: 'Adrift', image: 'apparel', price: 27900, compareAt: 31900, cost: 13100, short: 'Three-layer waterproof shell with taped seams.', options: { name: 'Size', values: ['S', 'M', 'L'] } },
  { name: 'Verdant Two-Person Tent', category: 'Camping', brand: 'Verdant', image: 'outdoors', price: 42900, cost: 20800, short: 'Freestanding tent that pitches in under two minutes.' },
  { name: 'Verdant Camp Stove', category: 'Camping', brand: 'Verdant', image: 'outdoors', price: 11900, cost: 4700, short: 'Folding stove with a wind-shielded burner.' },
  { name: 'Verdant Trail Bottle', category: 'Cycling', brand: 'Verdant', image: 'outdoors', price: 2900, cost: 900, short: 'Insulated bottle that fits a standard cage.', options: { name: 'Colour', values: ['Moss', 'Granite'] } },
  { name: 'Northwind Pannier Set', category: 'Cycling', brand: 'Northwind', image: 'outdoors', price: 18900, cost: 8200, short: 'Roll-top panniers with a welded waterproof liner.' },
  { name: 'Oakline Standing Desk', category: 'Desk', brand: 'Oakline', image: 'office', price: 64900, compareAt: 72900, cost: 32500, short: 'Dual-motor sit-stand desk with memory presets.' },
  { name: 'Oakline Monitor Riser', category: 'Desk', brand: 'Oakline', image: 'office', price: 8900, cost: 3400, short: 'Solid-oak riser with a cable channel.' },
  { name: 'Northwind Notebook Trio', category: 'Stationery', brand: 'Northwind', image: 'office', price: 2400, cost: 800, short: 'Three stitched notebooks with 100gsm paper.', options: { name: 'Ruling', values: ['Dotted', 'Lined', 'Plain'] } },
  { name: 'Kestrel Chef Knife', category: 'Kitchen', brand: 'Kestrel', image: 'kitchen', price: 19900, cost: 8900, short: 'Forged 20cm blade with a full-tang handle.' },
  { name: 'Lumen Pour-Over Kettle', category: 'Kitchen', brand: 'Lumen', image: 'kitchen', price: 13900, cost: 5600, short: 'Gooseneck kettle with one-degree temperature control.' },
  { name: 'Verdant Yoga Mat', category: 'Fitness', brand: 'Verdant', image: 'fitness', price: 7900, cost: 2900, short: 'Natural rubber mat with an alignment print.', options: { name: 'Thickness', values: ['4mm', '6mm'] } },
  { name: 'Kestrel Kettlebell 12kg', category: 'Fitness', brand: 'Kestrel', image: 'fitness', price: 8900, cost: 4100, short: 'Powder-coated cast iron with a wide handle.' },
];

const DEMO_CUSTOMERS = [
  ['Amara', 'Okonkwo', 'amara.okonkwo@example.com', 'NG', 'Lagos'],
  ['Jonas', 'Weber', 'jonas.weber@example.com', 'DE', 'Hamburg'],
  ['Priya', 'Raman', 'priya.raman@example.com', 'IN', 'Bengaluru'],
  ['Elena', 'Costa', 'elena.costa@example.com', 'PT', 'Porto'],
  ['Tom', 'Fletcher', 'tom.fletcher@example.com', 'GB', 'Bristol'],
  ['Sofia', 'Marquez', 'sofia.marquez@example.com', 'ES', 'Valencia'],
  ['Daniel', 'Osei', 'daniel.osei@example.com', 'GH', 'Accra'],
  ['Mia', 'Nakamura', 'mia.nakamura@example.com', 'JP', 'Osaka'],
  ['Lucas', 'Brandt', 'lucas.brandt@example.com', 'US', 'Portland'],
  ['Zara', 'Haddad', 'zara.haddad@example.com', 'AE', 'Dubai'],
  ['Niamh', 'Doyle', 'niamh.doyle@example.com', 'IE', 'Galway'],
  ['Kwame', 'Mensah', 'kwame.mensah@example.com', 'GH', 'Kumasi'],
] as const;

const seedDemoData = async (adminUserId: string): Promise<void> => {
  const random = makeRandom(20_261_104);

  // ── Brands ──
  const brandIdByName = new Map<string, string>();
  for (const name of DEMO_BRANDS) {
    const brand = await db.brand.upsert({
      where: { slug: slugify(name) },
      create: { name, slug: slugify(name), isActive: true },
      update: { name, isActive: true, deletedAt: null },
      select: { id: true },
    });
    brandIdByName.set(name, brand.id);
  }
  log(`brands: ${brandIdByName.size}`);

  // ── Categories ──
  const categoryIdByName = new Map<string, string>();
  let position = 0;
  for (const group of DEMO_CATEGORIES) {
    const parent = await db.category.upsert({
      where: { slug: slugify(group.name) },
      create: {
        name: group.name,
        slug: slugify(group.name),
        isActive: true,
        position: position,
        imageUrl: `/demo/${group.image}.svg`,
        description: `Browse our ${group.name.toLowerCase()} range.`,
      },
      update: { name: group.name, isActive: true, deletedAt: null },
      select: { id: true },
    });
    categoryIdByName.set(group.name, parent.id);
    position += 1;

    let childPosition = 0;
    for (const childName of group.children) {
      const child = await db.category.upsert({
        where: { slug: slugify(childName) },
        create: {
          name: childName,
          slug: slugify(childName),
          parentId: parent.id,
          isActive: true,
          position: childPosition,
        },
        update: { name: childName, parentId: parent.id, isActive: true, deletedAt: null },
        select: { id: true },
      });
      categoryIdByName.set(childName, child.id);
      childPosition += 1;
    }
  }
  log(`categories: ${categoryIdByName.size}`);

  // ── Products, variants, inventory ──
  let productsCreated = 0;

  for (const [index, spec] of DEMO_PRODUCTS.entries()) {
    const slug = slugify(spec.name);
    const categoryId = categoryIdByName.get(spec.category) ?? null;
    const brandId = brandIdByName.get(spec.brand) ?? null;

    const existing = await db.product.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existing) continue;

    const product = await db.product.create({
      data: {
        name: spec.name,
        slug,
        shortDescription: spec.short,
        description: `${spec.short}\n\nEvery ${spec.brand} product is covered by a two-year warranty and ships within one working day. This catalogue entry is sample data created by the seed script.`,
        status: ProductStatus.ACTIVE,
        categoryId,
        brandId,
        basePrice: spec.price,
        compareAtPrice: spec.compareAt ?? null,
        costPrice: spec.cost,
        currency: 'USD',
        taxRateBps: 0,
        isFeatured: index % 6 === 0,
        trackInventory: true,
        weightGrams: 300 + Math.floor(random() * 2400),
        metaTitle: spec.name,
        metaDescription: spec.short,
        publishedAt: new Date(Date.now() - (index + 1) * 36 * 60 * 60 * 1000),
        createdById: adminUserId,
        updatedById: adminUserId,
        images: {
          create: [
            {
              url: `/demo/${spec.image}.svg`,
              alt: `${spec.name} shown against a plain background`,
              position: 0,
              isPrimary: true,
            },
          ],
        },
      },
      select: { id: true },
    });

    const variantSpecs = spec.options
      ? spec.options.values.map((value, variantIndex) => ({
          label: value,
          sku: `${slugify(spec.brand).slice(0, 3).toUpperCase()}-${slug.slice(0, 10).toUpperCase().replace(/-/g, '')}-${variantIndex + 1}`,
          price: spec.price + variantIndex * 500,
        }))
      : [
          {
            label: 'Default',
            sku: `${slugify(spec.brand).slice(0, 3).toUpperCase()}-${slug.slice(0, 12).toUpperCase().replace(/-/g, '')}`,
            price: spec.price,
          },
        ];

    const option = spec.options
      ? await db.productOption.create({
          data: { productId: product.id, name: spec.options.name, position: 0 },
          select: { id: true },
        })
      : null;

    for (const [variantIndex, variantSpec] of variantSpecs.entries()) {
      const optionValueId =
        option && spec.options
          ? (
              await db.productOptionValue.create({
                data: {
                  optionId: option.id,
                  value: variantSpec.label,
                  position: variantIndex,
                },
                select: { id: true },
              })
            ).id
          : null;

      const variant = await db.productVariant.create({
        data: {
          productId: product.id,
          sku: variantSpec.sku,
          name: variantSpec.label,
          price: variantSpec.price,
          compareAtPrice: spec.compareAt ? spec.compareAt + variantIndex * 500 : null,
          costPrice: spec.cost,
          position: variantIndex,
          isDefault: variantIndex === 0,
          isActive: true,
          ...(optionValueId ? { optionValues: { create: { optionValueId } } } : {}),
        },
        select: { id: true },
      });

      // A few variants are deliberately low or out of stock so the low-stock
      // report and the out-of-stock storefront state both have real examples.
      const opening =
        index % 11 === 0 && variantIndex === 0
          ? 0
          : index % 7 === 0 && variantIndex === 0
            ? 3
            : 12 + Math.floor(random() * 80);

      await db.inventoryItem.create({
        data: {
          variantId: variant.id,
          quantityOnHand: opening,
          reorderPoint: 5,
          reorderQuantity: 25,
          binLocation: `A${1 + (index % 9)}-${1 + variantIndex}`,
        },
      });

      if (opening > 0) {
        await db.stockMovement.create({
          data: {
            variantId: variant.id,
            type: StockMovementType.RECEIPT,
            quantity: opening,
            balanceAfter: opening,
            reason: 'Opening stock',
            reference: 'seed',
            createdById: adminUserId,
          },
        });
      }
    }

    productsCreated += 1;
  }

  const productCount = await db.product.count({ where: { deletedAt: null } });
  log(`products: ${productCount} total (${productsCreated} created this run)`);

  // ── Customers ──
  const customerIds: string[] = [];
  for (const [firstName, lastName, email, countryCode, city] of DEMO_CUSTOMERS) {
    const customer = await db.customer.upsert({
      where: { email },
      create: {
        email,
        firstName,
        lastName,
        phone: `+1555${String(1_000_000 + Math.floor(random() * 8_999_999)).slice(0, 7)}`,
        status: CustomerStatus.ACTIVE,
        marketingOptIn: random() > 0.4,
        addresses: {
          create: {
            firstName,
            lastName,
            line1: `${1 + Math.floor(random() * 240)} Harbour Road`,
            city,
            countryCode,
            postalCode: String(10_000 + Math.floor(random() * 89_999)),
            isDefaultShipping: true,
            isDefaultBilling: true,
          },
        },
      },
      update: { firstName, lastName, deletedAt: null },
      select: { id: true },
    });
    customerIds.push(customer.id);
  }
  log(`customers: ${customerIds.length}`);

  // ── Discounts ──
  const discountSpecs = [
    { code: 'WELCOME10', name: 'Welcome 10% off', type: 'PERCENTAGE' as const, value: 1000, min: 0 },
    { code: 'SAVE20', name: 'Spend 150, save 20', type: 'FIXED_AMOUNT' as const, value: 2000, min: 15000 },
    { code: 'FREESHIP', name: 'Free shipping', type: 'FREE_SHIPPING' as const, value: 0, min: 5000 },
    { code: 'BULK15', name: 'Bulk order 15% off', type: 'PERCENTAGE' as const, value: 1500, min: 50000 },
  ];

  for (const spec of discountSpecs) {
    await db.discount.upsert({
      where: { code: spec.code },
      create: {
        code: spec.code,
        name: spec.name,
        description: `${spec.name}. Sample promotion created by the seed script.`,
        type: spec.type,
        value: spec.value,
        minSubtotal: spec.min,
        isActive: true,
        usageLimit: 500,
        perCustomerLimit: 2,
        startsAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        createdById: adminUserId,
      },
      update: { name: spec.name, isActive: true, deletedAt: null },
    });
  }
  log(`discounts: ${discountSpecs.length}`);

  // ── Orders ──
  const TARGET_ORDERS = 36;
  const existingOrders = await db.order.count();
  const ordersToCreate = Math.max(0, TARGET_ORDERS - existingOrders);

  if (ordersToCreate > 0) {
    const variants = await db.productVariant.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        price: true,
        isDefault: true,
        productId: true,
        product: { select: { name: true } },
      },
    });

    const addresses = await db.address.findMany({
      select: {
        customerId: true,
        firstName: true,
        lastName: true,
        line1: true,
        city: true,
        countryCode: true,
        postalCode: true,
      },
    });
    const addressByCustomer = new Map(addresses.map((address) => [address.customerId, address]));

    // Spread orders across the last 90 days so the dashboard trend is real.
    const statusPlan: { status: OrderStatus; payment: PaymentStatus; fulfilled: boolean }[] = [
      { status: OrderStatus.DELIVERED, payment: PaymentStatus.PAID, fulfilled: true },
      { status: OrderStatus.DELIVERED, payment: PaymentStatus.PAID, fulfilled: true },
      { status: OrderStatus.SHIPPED, payment: PaymentStatus.PAID, fulfilled: true },
      { status: OrderStatus.PROCESSING, payment: PaymentStatus.PAID, fulfilled: false },
      { status: OrderStatus.CONFIRMED, payment: PaymentStatus.PAID, fulfilled: false },
      { status: OrderStatus.PENDING, payment: PaymentStatus.UNPAID, fulfilled: false },
      { status: OrderStatus.CANCELLED, payment: PaymentStatus.UNPAID, fulfilled: false },
      { status: OrderStatus.REFUNDED, payment: PaymentStatus.REFUNDED, fulfilled: true },
    ];

    const counterRow = await db.counter.findUnique({ where: { key: 'order_number' } });
    let nextNumber = counterRow?.value ?? 100_000;

    for (let i = 0; i < ordersToCreate; i += 1) {
      const customerId = customerIds[Math.floor(random() * customerIds.length)];
      if (!customerId) continue;

      const customer = await db.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: { email: true, firstName: true, lastName: true },
      });
      const address = addressByCustomer.get(customerId);
      if (!address) continue;

      const plan = statusPlan[i % statusPlan.length];
      if (!plan) continue;

      const lineCount = 1 + Math.floor(random() * 3);
      const chosen = new Map<string, number>();
      for (let line = 0; line < lineCount; line += 1) {
        const variant = variants[Math.floor(random() * variants.length)];
        if (!variant) continue;
        chosen.set(variant.id, (chosen.get(variant.id) ?? 0) + 1 + Math.floor(random() * 2));
      }
      if (chosen.size === 0) continue;

      const items = [...chosen.entries()].map(([variantId, quantity]) => {
        const variant = variants.find((candidate) => candidate.id === variantId);
        return { variant, quantity };
      });

      const subtotal = items.reduce(
        (total, item) => total + (item.variant?.price ?? 0) * item.quantity,
        0,
      );
      const shipping = subtotal >= 20_000 ? 0 : 899;
      const grandTotal = subtotal + shipping;

      const daysAgo = Math.floor(random() * 90);
      const placedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      nextNumber += 1;

      const order = await db.order.create({
        data: {
          number: `ORD-${nextNumber}`,
          customerId,
          email: customer.email,
          status: plan.status,
          paymentStatus: plan.payment,
          fulfillmentStatus: plan.fulfilled
            ? FulfillmentStatus.FULFILLED
            : FulfillmentStatus.UNFULFILLED,
          currency: 'USD',
          subtotal,
          discountTotal: 0,
          taxTotal: 0,
          shippingTotal: shipping,
          grandTotal,
          refundedTotal: plan.status === OrderStatus.REFUNDED ? grandTotal : 0,
          channel: 'web',
          placedAt,
          createdAt: placedAt,
          cancelledAt: plan.status === OrderStatus.CANCELLED ? placedAt : null,
          items: {
            create: items
              .filter((item) => item.variant !== undefined)
              .map((item) => {
                const variant = item.variant as NonNullable<typeof item.variant>;
                return {
                  variantId: variant.id,
                  productId: variant.productId,
                  productName: variant.product.name,
                  variantName: variant.isDefault ? 'Default' : variant.name,
                  sku: variant.sku,
                  unitPrice: variant.price,
                  quantity: item.quantity,
                  lineTotal: variant.price * item.quantity,
                  quantityFulfilled: plan.fulfilled ? item.quantity : 0,
                };
              }),
          },
          addresses: {
            create: (['SHIPPING', 'BILLING'] as const).map((type) => ({
              type,
              firstName: address.firstName,
              lastName: address.lastName,
              line1: address.line1,
              city: address.city,
              countryCode: address.countryCode,
              postalCode: address.postalCode,
            })),
          },
          ...(plan.payment === PaymentStatus.PAID || plan.payment === PaymentStatus.REFUNDED
            ? {
                payments: {
                  create: {
                    provider: PaymentProvider.CARD,
                    amount: grandTotal,
                    currency: 'USD',
                    status: PaymentStatus.PAID,
                    capturedAt: placedAt,
                    reference: `seed-${nextNumber}`,
                  },
                },
              }
            : {}),
          ...(plan.fulfilled
            ? {
                shipments: {
                  create: {
                    carrier: 'Seed Logistics',
                    trackingNumber: `SL${1_000_000 + nextNumber}`,
                    status:
                      plan.status === OrderStatus.DELIVERED
                        ? ShipmentStatus.DELIVERED
                        : ShipmentStatus.IN_TRANSIT,
                    shippedAt: new Date(placedAt.getTime() + 24 * 60 * 60 * 1000),
                    deliveredAt:
                      plan.status === OrderStatus.DELIVERED
                        ? new Date(placedAt.getTime() + 4 * 24 * 60 * 60 * 1000)
                        : null,
                  },
                },
              }
            : {}),
          events: {
            create: {
              type: 'order.placed',
              message: 'Order placed (sample data).',
              createdAt: placedAt,
            },
          },
        },
        select: { id: true },
      });

      if (plan.status === OrderStatus.REFUNDED) {
        await db.refund.create({
          data: {
            orderId: order.id,
            amount: grandTotal,
            currency: 'USD',
            reason: 'Customer changed their mind (sample data).',
            restock: true,
            createdById: adminUserId,
          },
        });
      }
    }

    // Keep the shared counter ahead of the seeded numbers so the first real
    // order does not collide with sample data.
    await db.counter.upsert({
      where: { key: 'order_number' },
      create: { key: 'order_number', value: nextNumber },
      update: { value: nextNumber },
    });
  }

  const orderCount = await db.order.count();
  log(`orders: ${orderCount} total (${ordersToCreate} created this run)`);

  // ── Reviews ──
  const TARGET_REVIEWS = 28;
  const existingReviews = await db.review.count();
  const reviewsToCreate = Math.max(0, TARGET_REVIEWS - existingReviews);
  let reviewsCreated = 0;

  if (reviewsToCreate > 0) {
    const products = await db.product.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 40,
    });

    const bodies = [
      'Exactly what I needed and the build quality is better than I expected for the price.',
      'Arrived quickly and well packaged. Two weeks in and no complaints at all.',
      'Good value. It does the job, though the instructions could be clearer.',
      'Second one I have bought. The first is still going strong after a year of daily use.',
      'Solid product, but be aware it runs slightly larger than the sizing chart suggests.',
    ];

    for (let i = 0; i < reviewsToCreate; i += 1) {
      const product = products[i % products.length];
      const customerId = customerIds[i % customerIds.length];
      if (!product || !customerId) continue;

      const existing = await db.review.findFirst({
        where: { productId: product.id, customerId },
        select: { id: true },
      });
      if (existing) continue;

      const customer = await db.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: { firstName: true, lastName: true },
      });

      await db.review.create({
        data: {
          productId: product.id,
          customerId,
          authorName: `${customer.firstName} ${customer.lastName.charAt(0)}.`,
          rating: 3 + Math.floor(random() * 3),
          title: i % 3 === 0 ? 'Would buy again' : null,
          body: bodies[i % bodies.length] ?? bodies[0] ?? 'Good product.',
          status: i % 7 === 0 ? ReviewStatus.PENDING : ReviewStatus.APPROVED,
          moderatedAt: i % 7 === 0 ? null : new Date(),
        },
      });
      reviewsCreated += 1;
    }
  }

  const reviewCount = await db.review.count();
  // Report what was actually inserted, not what was attempted: the
  // one-review-per-customer-per-product rule can skip some of the top-up.
  log(`reviews: ${reviewCount} total (${reviewsCreated} created this run)`);

  // ── Demo staff accounts ──
  const demoStaff = [
    ['manager@example.com', 'Dana', 'Reyes', 'manager', 'Store Manager'],
    ['staff@example.com', 'Sam', 'Idowu', 'staff', 'Fulfilment Associate'],
  ] as const;

  for (const [email, firstName, lastName, roleKey, jobTitle] of demoStaff) {
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) continue;

    const role = await db.role.findUniqueOrThrow({
      where: { key: roleKey },
      select: { id: true },
    });

    await db.user.create({
      data: {
        email,
        firstName,
        lastName,
        jobTitle,
        status: UserStatus.ACTIVE,
        // No password: these accounts exist to demonstrate roles in the user
        // list. Use "Reset password" in the UI to issue credentials.
        passwordHash: null,
        mustChangePassword: true,
        createdById: adminUserId,
        roles: { create: { roleId: role.id } },
      },
    });
  }
  log(`demo staff: ${demoStaff.length} role examples (no passwords set)`);
};

// ── Entry point ──────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  process.stdout.write('\nSeeding Ecom\n\n');

  process.stdout.write('Reference data\n');
  await seedPermissions();
  await seedRoles();
  await seedSettings();
  const adminUserId = await seedSuperAdmin();

  const wantDemo = (process.env.SEED_DEMO_DATA ?? '').toLowerCase() === 'true';

  if (wantDemo) {
    if (process.env.NODE_ENV === 'production') {
      process.stdout.write(
        '\nRefusing to seed demo data with NODE_ENV=production. Unset SEED_DEMO_DATA.\n',
      );
    } else {
      process.stdout.write('\nDemo data\n');
      await seedDemoData(adminUserId);
    }
  } else {
    process.stdout.write('\nDemo data skipped (SEED_DEMO_DATA is not "true")\n');
  }

  process.stdout.write('\nSeed complete.\n\n');
};

main()
  .catch((error: unknown) => {
    process.stderr.write(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
