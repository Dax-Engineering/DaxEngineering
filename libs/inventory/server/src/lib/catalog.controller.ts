import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  type BrandDto,
  BrandInput,
  BrandUpdate,
  type CatalogLists,
  type MachineModelDto,
  MachineModelInput,
  MachineModelUpdate,
  type MachineTypeDto,
  MachineTypeInput,
  MachineTypeUpdate,
} from '@dax/inventory-contract';
import {
  assertWritable,
  AuditService,
  type DaxRequest,
  Requires,
  sessionOf,
} from '@dax/platform-core';
import { PrismaService, type TransactionClient } from '@dax/platform-db';
import {
  conflict,
  invalid,
  isUniqueViolation,
  MODULE_KEY,
  notFound,
  parse,
} from './common';
import { brandEntity, machineModelEntity, machineTypeEntity } from './entities';

const TYPE_EXISTS = 'A machine type with that name already exists.';

const BRAND_SELECT = {
  id: true,
  name: true,
  active: true,
  _count: { select: { items: true } },
} as const;

const MODEL_SELECT = {
  id: true,
  name: true,
  active: true,
  brand: { select: { id: true, name: true } },
  machineType: { select: { id: true, name: true } },
  _count: { select: { items: true } },
} as const;

const TYPE_SELECT = {
  id: true,
  name: true,
  active: true,
  _count: { select: { machineModels: true } },
} as const;

function toType(row: {
  id: string;
  name: string;
  active: boolean;
  _count: { machineModels: number };
}): MachineTypeDto {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    modelCount: row._count.machineModels,
  };
}

function toBrand(row: {
  id: string;
  name: string;
  active: boolean;
  _count: { items: number };
}): BrandDto {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    itemCount: row._count.items,
  };
}

function toModel(row: {
  id: string;
  name: string;
  active: boolean;
  brand: { id: string; name: string } | null;
  machineType: { id: string; name: string } | null;
  _count: { items: number };
}): MachineModelDto {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    machineType: row.machineType,
    active: row.active,
    itemCount: row._count.items,
  };
}

@Controller('inventory')
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('catalog')
  @Requires('inventory.catalog.view')
  async lists(): Promise<CatalogLists> {
    const [brands, models, types] = await Promise.all([
      this.prisma.brand.findMany({
        select: BRAND_SELECT,
        orderBy: { name: 'asc' },
      }),
      this.prisma.machineModel.findMany({
        select: MODEL_SELECT,
        orderBy: { name: 'asc' },
      }),
      this.prisma.machineType.findMany({
        select: TYPE_SELECT,
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      brands: brands.map(toBrand),
      machineModels: models.map(toModel),
      machineTypes: types.map(toType),
    };
  }

  @Post('machine-types')
  @Requires('inventory.catalog.manage')
  async createType(
    @Req() req: DaxRequest,
    @Body() body: unknown,
  ): Promise<MachineTypeDto> {
    const input = parse(MachineTypeInput, body);
    assertWritable(machineTypeEntity, sessionOf(req).policy, input);
    await this.assertTypeNameFree(input.name);
    const row = await this.guard('TYPE_EXISTS', TYPE_EXISTS, () =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.machineType.create({
          data: input,
          select: TYPE_SELECT,
        });
        await this.record(
          tx,
          machineTypeEntity.key,
          created.id,
          'create',
          null,
          input,
        );
        return created;
      }),
    );
    return toType(row);
  }

  @Patch('machine-types/:id')
  @Requires('inventory.catalog.manage')
  async updateType(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<MachineTypeDto> {
    const input = parse(MachineTypeUpdate, body);
    assertWritable(machineTypeEntity, sessionOf(req).policy, input);
    const before = await this.prisma.machineType.findUnique({ where: { id } });
    if (!before) notFound('Machine type not found.');
    if (input.name !== undefined) await this.assertTypeNameFree(input.name, id);
    const row = await this.guard('TYPE_EXISTS', TYPE_EXISTS, () =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.machineType.update({
          where: { id },
          data: input,
          select: TYPE_SELECT,
        });
        await this.record(
          tx,
          machineTypeEntity.key,
          id,
          'update',
          pick(before, input),
          input,
        );
        return updated;
      }),
    );
    return toType(row);
  }

  @Post('brands')
  @Requires('inventory.catalog.manage')
  async createBrand(
    @Req() req: DaxRequest,
    @Body() body: unknown,
  ): Promise<BrandDto> {
    const input = parse(BrandInput, body);
    assertWritable(brandEntity, sessionOf(req).policy, input);
    await this.assertBrandNameFree(input.name);
    const row = await this.guard(
      'BRAND_EXISTS',
      'A brand with that name already exists.',
      () =>
        this.prisma.$transaction(async (tx) => {
          const created = await tx.brand.create({
            data: input,
            select: BRAND_SELECT,
          });
          await this.record(
            tx,
            'inventory.brand',
            created.id,
            'create',
            null,
            input,
          );
          return created;
        }),
    );
    return toBrand(row);
  }

  @Patch('brands/:id')
  @Requires('inventory.catalog.manage')
  async updateBrand(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<BrandDto> {
    const input = parse(BrandUpdate, body);
    assertWritable(brandEntity, sessionOf(req).policy, input);
    const before = await this.prisma.brand.findUnique({ where: { id } });
    if (!before) notFound('Brand not found.');
    if (input.name !== undefined)
      await this.assertBrandNameFree(input.name, id);
    const row = await this.guard(
      'BRAND_EXISTS',
      'A brand with that name already exists.',
      () =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.brand.update({
            where: { id },
            data: input,
            select: BRAND_SELECT,
          });
          await this.record(
            tx,
            'inventory.brand',
            id,
            'update',
            pick(before, input),
            input,
          );
          return updated;
        }),
    );
    return toBrand(row);
  }

  @Post('machine-models')
  @Requires('inventory.catalog.manage')
  async createModel(
    @Req() req: DaxRequest,
    @Body() body: unknown,
  ): Promise<MachineModelDto> {
    const input = parse(MachineModelInput, body);
    assertWritable(machineModelEntity, sessionOf(req).policy, input);
    await this.assertModelNameFree(input.name);
    await this.assertBrand(input.brandId);
    await this.assertType(input.machineTypeId);
    const row = await this.guard(
      'MODEL_EXISTS',
      'A machine model with that name already exists.',
      () =>
        this.prisma.$transaction(async (tx) => {
          const created = await tx.machineModel.create({
            data: input,
            select: MODEL_SELECT,
          });
          await this.record(
            tx,
            'inventory.machine_model',
            created.id,
            'create',
            null,
            input,
          );
          return created;
        }),
    );
    return toModel(row);
  }

  @Patch('machine-models/:id')
  @Requires('inventory.catalog.manage')
  async updateModel(
    @Req() req: DaxRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<MachineModelDto> {
    const input = parse(MachineModelUpdate, body);
    assertWritable(machineModelEntity, sessionOf(req).policy, input);
    const before = await this.prisma.machineModel.findUnique({ where: { id } });
    if (!before) notFound('Machine model not found.');
    if (input.name !== undefined)
      await this.assertModelNameFree(input.name, id);
    if (input.brandId !== undefined) await this.assertBrand(input.brandId);
    if (input.machineTypeId !== undefined)
      await this.assertType(input.machineTypeId);
    const row = await this.guard(
      'MODEL_EXISTS',
      'A machine model with that name already exists.',
      () =>
        this.prisma.$transaction(async (tx) => {
          const updated = await tx.machineModel.update({
            where: { id },
            data: input,
            select: MODEL_SELECT,
          });
          await this.record(
            tx,
            'inventory.machine_model',
            id,
            'update',
            pick(before, input),
            input,
          );
          return updated;
        }),
    );
    return toModel(row);
  }

  private async assertBrandNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.brand.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash)
      conflict('BRAND_EXISTS', 'A brand with that name already exists.');
  }

  private async assertModelNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.machineModel.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash)
      conflict(
        'MODEL_EXISTS',
        'A machine model with that name already exists.',
      );
  }

  private async assertTypeNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.machineType.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) conflict('TYPE_EXISTS', TYPE_EXISTS);
  }

  private async assertType(machineTypeId: string | null) {
    if (!machineTypeId) return;
    const type = await this.prisma.machineType.findUnique({
      where: { id: machineTypeId },
      select: { id: true },
    });
    if (!type) invalid('Unknown machine type.', ['machineTypeId']);
  }

  private async assertBrand(brandId: string | null) {
    if (!brandId) return;
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: { id: true },
    });
    if (!brand) invalid('Unknown brand.', ['brandId']);
  }

  private async guard<T>(
    code: string,
    message: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) conflict(code, message);
      throw error;
    }
  }

  private record(
    tx: TransactionClient,
    entityKey: string,
    entityId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ) {
    return this.audit.record(
      { moduleKey: MODULE_KEY, entityKey, entityId, action, before, after },
      tx,
    );
  }
}

function pick(row: Record<string, unknown>, keys: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(keys).map((k) => [k, row[k]]));
}
