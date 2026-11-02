-- A set is added first with its classes (any combination, not only a range); its cloth photo,
-- description and sizes come after, when the retailer creates the mock-ups.
-- Sets from before this have no list: their classes are class_from to class_to.
ALTER TABLE uniforms ADD COLUMN classes TEXT;
ALTER TABLE uniforms ADD COLUMN description TEXT NOT NULL DEFAULT '';
