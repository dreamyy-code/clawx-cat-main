require "rbconfig"

module FPM
  module Util
    def program_in_path?(program)
      return false unless ENV["PATH"]

      envpath = ENV["PATH"].split(File::PATH_SEPARATOR)

      if Gem.win_platform?
        exts = ENV.fetch("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(";")
        return envpath.any? do |p|
          base = File.join(p, program)
          File.executable?(base) || exts.any? do |ext|
            File.executable?("#{base}#{ext.downcase}") || File.executable?("#{base}#{ext.upcase}")
          end
        end
      end

      envpath.any? { |p| File.executable?(File.join(p, program)) }
    end
  end
end
