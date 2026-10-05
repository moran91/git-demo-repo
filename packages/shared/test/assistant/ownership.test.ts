import { describe, expect, it } from 'vitest';
import { isMachineOwned, resolveAutoFields, same, type AutoTagResult } from '../../src/index.js';

const suggested: AutoTagResult = { tags: ['spicy', 'vegetarian'], serves: 2, dishType: 'pizza' };
const noType: AutoTagResult = { tags: [], serves: 1 };

describe('resolveAutoFields', () => {
  it('a new product with nothing sent takes the suggestion, machine-owned', () => {
    const r = resolveAutoFields({}, undefined, suggested);
    expect(r.values).toEqual({ tags: ['spicy', 'vegetarian'], serves: 2, dishType: 'pizza' });
    expect(r.autoFields).toEqual(r.values);
  });
  it('a sent value equal to the suggestion stays machine-owned (order of tags does not matter)', () => {
    const r = resolveAutoFields({ tags: ['vegetarian', 'spicy'], serves: 2, dishType: 'pizza' }, undefined, suggested);
    expect(r.autoFields).toEqual({ tags: ['vegetarian', 'spicy'], serves: 2, dishType: 'pizza' });
  });
  it('a different sent value becomes the owner’s', () => {
    const r = resolveAutoFields({ tags: ['kids'], serves: 3, dishType: 'pasta' }, undefined, suggested);
    expect(r.values).toEqual({ tags: ['kids'], serves: 3, dishType: 'pasta' });
    expect(r.autoFields).toEqual({});
  });
  it('omitted keeps the stored value and its mark', () => {
    const existing = { tags: ['kids' as const], serves: 3, dishType: 'pizza' as const, autoFields: { dishType: 'pizza' as const } };
    const r = resolveAutoFields({}, existing, suggested);
    expect(r.values).toEqual({ tags: ['kids'], serves: 3, dishType: 'pizza' });
    expect(r.autoFields).toEqual({ dishType: 'pizza' });
  });
  it("'none' clears the type and makes it the owner's", () => {
    const r = resolveAutoFields({ dishType: 'none' }, undefined, suggested);
    expect(r.values.dishType).toBeUndefined();
    expect(r.autoFields.dishType).toBeUndefined();
    expect(isMachineOwned({ ...r.values, autoFields: r.autoFields }, 'dishType')).toBe(false);
  });
  it('legacy product, omitted fields → suggestion applied and marked', () => {
    const r = resolveAutoFields({}, {}, suggested);
    expect(r.values).toEqual({ tags: ['spicy', 'vegetarian'], serves: 2, dishType: 'pizza' });
    expect(r.autoFields).toEqual(r.values);
  });
  it('legacy product keeps the values it already has and leaves them unmarked', () => {
    const r = resolveAutoFields({}, { dishType: 'pasta' }, suggested);
    expect(r.values.dishType).toBe('pasta');
    expect(r.autoFields.dishType).toBeUndefined();
    expect(r.autoFields.tags).toEqual(['spicy', 'vegetarian']);
  });
  it('a new dish with no detected type stays machine-owned and empty', () => {
    const r = resolveAutoFields({}, undefined, noType);
    expect(r.values).toEqual({ tags: [], serves: 1 });
    expect(r.autoFields).toEqual({ tags: [], serves: 1, dishType: 'none' });
    expect(isMachineOwned({ ...r.values, autoFields: r.autoFields }, 'dishType')).toBe(true);
    expect(isMachineOwned({ ...r.values, autoFields: r.autoFields }, 'tags')).toBe(true);
  });
  it("a sent 'none' or [] equal to an empty suggestion stays machine-owned", () => {
    const r = resolveAutoFields({ dishType: 'none', tags: [] }, undefined, noType);
    expect(r.autoFields).toEqual({ tags: [], serves: 1, dishType: 'none' });
    expect(r.values.dishType).toBeUndefined();
  });
  it('renaming a machine-owned empty dish to a pizza name later derives pizza', () => {
    const first = resolveAutoFields({}, undefined, noType);
    const stored = { ...first.values, autoFields: first.autoFields };
    const r = resolveAutoFields({}, stored, { tags: ['vegetarian'], serves: 2, dishType: 'pizza' });
    expect(r.values).toEqual({ tags: ['vegetarian'], serves: 2, dishType: 'pizza' });
    expect(r.autoFields).toEqual(r.values);
  });
  it('an owner-owned empty type stays empty when the name later suggests a type', () => {
    const first = resolveAutoFields({ dishType: 'none' }, undefined, suggested);
    const stored = { ...first.values, autoFields: first.autoFields };
    const r = resolveAutoFields({}, stored, suggested);
    expect(r.values.dishType).toBeUndefined();
    expect(r.autoFields.dishType).toBeUndefined();
  });
});

describe('owner-owned fields survive an omitted empty autoFields', () => {
  it('a cleared type stored with autoFields omitted but serves set stays the owner’s', () => {
    const first = resolveAutoFields({ dishType: 'none', tags: ['kids'], serves: 3 }, undefined, suggested);
    expect(first.autoFields).toEqual({});
    const stored = { ...first.values }; // autoFields {} omitted by the writer
    expect('autoFields' in stored).toBe(false);
    expect(isMachineOwned(stored, 'dishType')).toBe(false);
    expect(isMachineOwned(stored, 'tags')).toBe(false);
    const r = resolveAutoFields({}, stored, suggested);
    expect(r.values).toEqual({ tags: ['kids'], serves: 3 });
    expect(r.autoFields).toEqual({});
  });
});

describe('isMachineOwned', () => {
  it('older products (no autoFields) are machine-owned only where empty', () => {
    expect(isMachineOwned({ dishType: 'pizza' }, 'dishType')).toBe(false);
    expect(isMachineOwned({}, 'tags')).toBe(true);
  });
  it('newer products follow the marks', () => {
    expect(isMachineOwned({ tags: [], autoFields: { tags: [] } }, 'tags')).toBe(true);
    expect(isMachineOwned({ tags: [], autoFields: {} }, 'tags')).toBe(false);
  });
  it('a mark that no longer matches the stored value no longer counts', () => {
    expect(isMachineOwned({ dishType: 'pasta', autoFields: { dishType: 'pizza' } }, 'dishType')).toBe(false);
    expect(isMachineOwned({ dishType: 'pizza', autoFields: { dishType: 'pizza' } }, 'dishType')).toBe(true);
    expect(isMachineOwned({ autoFields: { dishType: 'none' } }, 'dishType')).toBe(true);
    expect(isMachineOwned({ dishType: 'pizza', autoFields: { dishType: 'none' } }, 'dishType')).toBe(false);
    expect(isMachineOwned({ tags: ['kids'], autoFields: { tags: ['spicy'] } }, 'tags')).toBe(false);
  });
});

describe('same', () => {
  it('compares tag lists regardless of order, and scalars by value', () => {
    expect(same(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(same(['a'], ['b'])).toBe(false);
    expect(same(2, 2)).toBe(true);
    expect(same(undefined, 2)).toBe(false);
  });
});
