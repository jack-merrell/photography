#!/usr/bin/env ruby

require "csv"
require "find"
require "open3"
require "shellwords"

IMAGE_EXTENSIONS = [".jpg", ".jpeg"].freeze
IGNORED_DIRS = %w[.git node_modules dist].freeze
PREFIX = "mkjr"
MANIFEST_PATH = "photo-rename-manifest.csv"
UNDO_PATH = "photo-rename-undo.sh"

CAMERA_SLUG_OVERRIDES = {
  "Canon EOS 7D" => "canon-eos-7d",
  "Canon EOS 6D" => "canon-eos-6d",
  "Canon EOS 6D Mark II" => "canon-eos-6d-mark-ii",
  "ILCE-7CM2" => "sony-ilce-7cm2",
  "iPhone 12 Pro" => "iphone-12-pro",
  "DMC-GF7" => "panasonic-dmc-gf7",
  "EZ Controller" => "noritsu-scan",
  "QSS-32_33" => "noritsu-scan"
}.freeze

def mdls_value(path, key)
  stdout, status = Open3.capture2("mdls", "-raw", "-name", key, path)
  raise "mdls failed for #{path} (#{key})" unless status.success?

  stdout.strip
end

def slugify(value)
  slug = value.to_s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")
  slug.empty? ? "unknown-camera" : slug
end

def camera_slug(make, model)
  return CAMERA_SLUG_OVERRIDES[model] if CAMERA_SLUG_OVERRIDES.key?(model)

  combined = [make, model]
    .reject { |part| part.nil? || part.empty? || part == "(null)" }
    .join(" ")

  slugify(combined)
end

def capture_date(raw_date, path)
  return raw_date[0, 10].delete("-") unless raw_date.nil? || raw_date.empty? || raw_date == "(null)"

  File.mtime(path).strftime("%Y%m%d")
end

def capture_timestamp(raw_date, path)
  return raw_date unless raw_date.nil? || raw_date.empty? || raw_date == "(null)"

  File.mtime(path).utc.strftime("%Y-%m-%d %H:%M:%S +0000")
end

def image_files
  files = []

  Find.find(".") do |path|
    if File.directory?(path)
      name = File.basename(path)
      if IGNORED_DIRS.include?(name)
        Find.prune
      else
        next
      end
    end

    next unless File.file?(path)
    next unless IMAGE_EXTENSIONS.include?(File.extname(path).downcase)
    next if File.basename(path) == MANIFEST_PATH
    next if File.basename(path) == UNDO_PATH

    files << path.sub(%r{\A\./}, "")
  end

  files.sort
end

def build_plan
  files = image_files

  rows = files.map do |path|
    raw_date = mdls_value(path, "kMDItemContentCreationDate")
    make = mdls_value(path, "kMDItemAcquisitionMake")
    model = mdls_value(path, "kMDItemAcquisitionModel")
    width = mdls_value(path, "kMDItemPixelWidth")
    height = mdls_value(path, "kMDItemPixelHeight")

    {
      old_path: path,
      old_name: File.basename(path),
      directory: File.dirname(path),
      capture_date: capture_date(raw_date, path),
      capture_timestamp: capture_timestamp(raw_date, path),
      make: make,
      model: model,
      width: width,
      height: height,
      camera_slug: camera_slug(make, model)
    }
  end

  groups = rows.group_by { |row| [row[:directory], row[:capture_date], row[:camera_slug]] }

  planned = groups.values.flat_map do |group|
    group
      .sort_by { |row| [row[:capture_timestamp], row[:old_name].downcase] }
      .each_with_index.map do |row, index|
        sequence = format("%03d", index + 1)
        new_name = "#{PREFIX}_#{row[:capture_date]}_#{row[:camera_slug]}_#{sequence}.jpg"
        new_path = row[:directory] == "." ? new_name : File.join(row[:directory], new_name)

        row.merge(new_name: new_name, new_path: new_path)
      end
  end

  duplicate_targets = planned.group_by { |row| row[:new_path] }.select { |_target, rows_for_target| rows_for_target.size > 1 }
  raise "Duplicate target names detected: #{duplicate_targets.keys.join(', ')}" unless duplicate_targets.empty?

  planned.sort_by { |row| row[:old_path].downcase }
end

def write_manifest(plan)
  CSV.open(MANIFEST_PATH, "w") do |csv|
    csv << ["old_path", "new_path", "capture_timestamp", "capture_date", "camera_slug", "make", "model", "width", "height"]
    plan.each do |row|
      csv << [
        row[:old_path],
        row[:new_path],
        row[:capture_timestamp],
        row[:capture_date],
        row[:camera_slug],
        row[:make],
        row[:model],
        row[:width],
        row[:height]
      ]
    end
  end
end

def write_undo_script(plan)
  lines = ["#!/usr/bin/env bash", "set -euo pipefail"]
  plan.reverse_each do |row|
    lines << "mv #{Shellwords.escape(row[:new_path])} #{Shellwords.escape(row[:old_path])}"
  end

  File.write(UNDO_PATH, lines.join("\n") + "\n")
  File.chmod(0o755, UNDO_PATH)
end

def apply_plan(plan)
  temp_pairs = []

  plan.each_with_index do |row, index|
    temp_path = "#{row[:old_path]}.codex-tmp-#{format('%03d', index)}"
    File.rename(row[:old_path], temp_path)
    temp_pairs << [temp_path, row[:new_path]]
  end

  temp_pairs.each do |temp_path, final_path|
    File.rename(temp_path, final_path)
  end
end

apply = ARGV.include?("--apply")
plan = build_plan

if plan.empty?
  puts "No JPG/JPEG files found."
  exit 0
end

plan.each do |row|
  puts "#{row[:old_path]} -> #{row[:new_path]}"
end

unless apply
  puts
  puts "Dry run only. Re-run with --apply to rename #{plan.length} files."
  exit 0
end

write_manifest(plan)
write_undo_script(plan)
apply_plan(plan)

puts
puts "Renamed #{plan.length} files."
puts "Manifest: #{MANIFEST_PATH}"
puts "Undo script: #{UNDO_PATH}"
